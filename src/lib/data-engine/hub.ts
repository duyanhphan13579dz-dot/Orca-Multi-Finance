import "server-only";
import { coalesce, hubPeek } from "./coalesce";
import { hubStats, runInDataHub } from "./request-scope";
import { catalogSummary, SOURCE_CATALOG } from "./catalog";
import { firstHealthy, withTimeout } from "./resilience";
import { routeForDomain, syncAllSources } from "./source-sync";

/**
 * Data Engine Hub — shared accessors for modules.
 *
 * Rule: modules MUST prefer hub getters over calling providers directly
 * so valuation / agent / screener / CANSLIM / portfolio share one fetch per key per request.
 */

export { runInDataHub, hubStats };
export { SOURCE_CATALOG, catalogSummary };

const kFin = (symbol: string) => `financial:package:${symbol.trim().toUpperCase()}`;
const kQuote = (symbolsKey: string) => `market:quote:${symbolsKey}`;
const kCrypto = (symbol: string) => `crypto:quote:${symbol.trim().toUpperCase()}`;
const kForex = (pair: string) => `forex:pair:${pair.trim().toUpperCase()}`;
const kCommodity = (id: string) => `commodity:${id.trim().toLowerCase()}`;
const kNews = (q: string) => `news:${q.trim().toLowerCase().slice(0, 80)}`;
const kMacro = (id: string) => `macro:${id}`;

/** Generic shared load */
export async function hubLoad<T>(
  key: string,
  producer: () => Promise<T>,
  sourceIds: string[] = [],
): Promise<T> {
  return coalesce(key, producer, { sourceIds });
}

/**
 * Financial package (BCTC + quality) — singleflight per symbol per request.
 */
export async function hubFinancialPackage(symbol: string) {
  const sym = symbol.trim().toUpperCase();
  return coalesce(kFin(sym), async () => {
    return withTimeout(10_000, async () => {
      const { getFinancialPackage } = await import("../financial/service");
      return getFinancialPackage(sym);
    }, "hubFinancialPackage");
  }, { sourceIds: ["vndirect-fs"] });
}

/** Peek financial package if already loaded in this request (no network). */
export function hubFinancialPackagePeek(symbol: string) {
  return hubPeek(kFin(symbol.trim().toUpperCase()));
}

/** Loose quote shape from multi-source VN providers (extra fields allowed). */
export type HubVnQuote = {
  symbol?: string;
  name?: string | null;
  price?: number | null;
  change?: number | null;
  changePercent?: number | null;
  volume?: number | null;
  quoteVolume?: number | null;
  high?: number | null;
  low?: number | null;
  open?: number | null;
  referencePrice?: number | null;
  updatedAt?: number | null;
  [key: string]: unknown;
};

export type HubVnQuotesResult = {
  quotes: HubVnQuote[];
  sourceTs: number | null;
  meta: Record<string, unknown> | null;
};

function normalizeQuotes(raw: unknown, sourceId: string): HubVnQuotesResult | null {
  if (raw == null) return null;
  const r = raw as {
    quotes?: HubVnQuote[];
    data?: HubVnQuote[];
    meta?: Record<string, unknown>;
    sourceTs?: number;
  };
  const list = Array.isArray(r.quotes)
    ? r.quotes
    : Array.isArray(r.data)
      ? r.data
      : Array.isArray(raw)
        ? (raw as HubVnQuote[])
        : null;
  if (!list || !list.length) return null;
  return {
    quotes: list,
    sourceTs: typeof r.sourceTs === "number" ? r.sourceTs : Date.now(),
    meta: { ...(r.meta ?? {}), source: sourceId },
  };
}

export async function hubVnQuotes(symbols: string[]): Promise<HubVnQuotesResult> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].sort();
  if (!uniq.length) return { quotes: [], sourceTs: null, meta: null };
  const key = kQuote(uniq.join(","));
  return coalesce(
    key,
    async (): Promise<HubVnQuotesResult> => {
      void syncAllSources().catch(() => null);
      const preferred = routeForDomain("market");

      const attempts = [
        {
          id: "stocks-service",
          run: async () => {
            const stocks = (await import("../services/stocks").catch(() => null)) as unknown as {
              getVnQuotes?: (s: string[]) => Promise<unknown>;
            } | null;
            if (!stocks || typeof stocks.getVnQuotes !== "function") {
              throw new Error("stocks_service_unavailable");
            }
            return stocks.getVnQuotes(uniq);
          },
          accept: (v: unknown) => normalizeQuotes(v, "stocks-service") != null,
        },
        {
          id: "vndirect",
          run: async () => {
            const { getVndQuotes } = await import("../providers/vndirect");
            return getVndQuotes(uniq);
          },
          accept: (v: unknown) => normalizeQuotes(v, "vndirect") != null,
        },
        {
          id: "ssi-fcdata",
          run: async () => {
            const mod = (await import("../providers/ssi-fcdata").catch(() => null)) as unknown as {
              getSsiQuotes?: (s: string[]) => Promise<unknown>;
            } | null;
            if (!mod || typeof mod.getSsiQuotes !== "function") {
              throw new Error("ssi_unavailable");
            }
            return mod.getSsiQuotes(uniq);
          },
          accept: (v: unknown) => normalizeQuotes(v, "ssi-fcdata") != null,
        },
      ];

      const order = ["stocks-service", ...preferred.filter((id) => id !== "stocks-service")];
      attempts.sort((a, b) => {
        const ia = order.indexOf(a.id);
        const ib = order.indexOf(b.id);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });

      try {
        const hit = await firstHealthy(attempts, {
          budgetMs: 8_000,
          perAttemptMs: 3_500,
          label: "hubVnQuotes",
        });
        const norm = normalizeQuotes(hit.value, hit.sourceId);
        if (norm) {
          return {
            ...norm,
            meta: {
              ...(norm.meta ?? {}),
              source: hit.sourceId,
              freshness: "FRESH",
            },
          };
        }
      } catch {
        /* empty pack */
      }
      return { quotes: [], sourceTs: null, meta: { source: "none", freshness: "STALE" } };
    },
    { sourceIds: ["vndirect", "ssi-fcdata", "stocks-service"] },
  );
}

export function hubVnQuotesPeek(symbols: string[]) {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].sort();
  return hubPeek(kQuote(uniq.join(",")));
}

/** Crypto spot ticker (Binance primary). */
export async function hubCryptoDetail(symbol: string) {
  const sym = symbol.trim().toUpperCase().replace(/USDT$/, "") + "USDT";
  return coalesce(
    kCrypto(sym),
    async () => {
      return withTimeout(
        3_500,
        async () => {
          const { getSpotTicker } = await import("../providers/binance");
          return getSpotTicker(sym);
        },
        "hubCryptoDetail",
      );
    },
    { sourceIds: ["binance"] },
  );
}

/** Forex pair rate. */
export async function hubForexDetail(pair: string) {
  const p = pair.trim().toUpperCase().replace(/[\/\s]/g, "");
  return coalesce(
    kForex(p),
    async () => {
      return withTimeout(
        3_500,
        async () => {
          const { getBiquoteQuotes } = await import("../providers/forex");
          const r = await getBiquoteQuotes([p]);
          return { pair: p, rate: r.rates[p] ?? null, ts: r.ts, rates: r.rates };
        },
        "hubForexDetail",
      );
    },
    { sourceIds: ["forex-feed"] },
  );
}

/** Commodity market snapshot (VietnamBiz goods). */
export async function hubCommodityMarket(id = "all") {
  const key = kCommodity(id || "all");
  return coalesce(
    key,
    async () => {
      return withTimeout(
        4_500,
        async () => {
          const { fetchVietnambizGoods } = await import("../providers/commodities");
          return fetchVietnambizGoods();
        },
        "hubCommodityMarket",
      );
    },
    { sourceIds: ["commodities"] },
  );
}

/** News feed via shared key. */
export async function hubNews(opts?: { symbol?: string; limit?: number }) {
  const q = opts?.symbol ? `sym:${opts.symbol}` : "general";
  return coalesce(
    kNews(q),
    async () => {
      return withTimeout(
        5_000,
        async () => {
          const { getNews } = await import("../services/news");
          return getNews({ symbol: opts?.symbol, limit: opts?.limit ?? 10 });
        },
        "hubNews",
      );
    },
    { sourceIds: ["news"] },
  );
}

/** Macro / rates snapshot by id. */
export async function hubMacro(id: string) {
  return coalesce(
    kMacro(id),
    async () => {
      return withTimeout(
        5_000,
        async () => {
          const { getEconomyBundle } = await import("../services/economy").catch(() => ({
            getEconomyBundle: null,
          }));
          if (!getEconomyBundle) throw new Error("economy_unavailable");
          return getEconomyBundle();
        },
        "hubMacro",
      );
    },
    { sourceIds: ["macro"] },
  );
}

export function hubCrossCheckNumbers(
  pairs: { label: string; a: number | null | undefined; b: number | null | undefined }[],
  tolPct = 2,
) {
  const details = pairs.map(({ label, a, b }) => {
    const na = a != null && Number.isFinite(a) ? Number(a) : null;
    const nb = b != null && Number.isFinite(b) ? Number(b) : null;
    if (na == null || nb == null) return { label, ok: true, a: na, b: nb };
    const base = Math.max(Math.abs(na), Math.abs(nb), 1e-9);
    const ok = (Math.abs(na - nb) / base) * 100 <= tolPct;
    return { label, ok, a: na, b: nb };
  });
  return { ok: details.every((d) => d.ok), details };
}

/**
 * Parallel warm-up of independent domains.
 */
export async function hubPrefetch(opts?: {
  symbols?: string[];
  commodity?: boolean;
  newsSymbol?: string;
}): Promise<{ ok: string[]; failed: string[]; ms: number }> {
  const t0 = performance.now();
  const ok: string[] = [];
  const failed: string[] = [];
  const jobs: Array<Promise<void>> = [];

  jobs.push(
    syncAllSources()
      .then(() => {
        ok.push("source-sync");
      })
      .catch(() => {
        failed.push("source-sync");
      }),
  );

  if (opts?.symbols?.length) {
    jobs.push(
      hubVnQuotes(opts.symbols)
        .then(() => {
          ok.push("vn-quotes");
        })
        .catch(() => {
          failed.push("vn-quotes");
        }),
    );
  }
  if (opts?.commodity !== false) {
    jobs.push(
      hubCommodityMarket()
        .then(() => {
          ok.push("commodity");
        })
        .catch(() => {
          failed.push("commodity");
        }),
    );
  }
  if (opts?.newsSymbol) {
    jobs.push(
      hubNews({ symbol: opts.newsSymbol, limit: 5 })
        .then(() => {
          ok.push("news");
        })
        .catch(() => {
          failed.push("news");
        }),
    );
  }

  await Promise.all(jobs);
  return { ok, failed, ms: Math.round(performance.now() - t0) };
}

export { syncAllSources, getLastSync, routeForDomain } from "./source-sync";

export const HubKeys = {
  financial: kFin,
  quote: kQuote,
  crypto: kCrypto,
  forex: kForex,
  commodity: kCommodity,
  news: kNews,
  macro: kMacro,
};

/**
 * Smart Portfolio / Nhật ký → Data Hub: marks đa loại tài sản từ nguồn dùng chung.
 */
export type HubPortfolioMark = {
  assetType: import("./asset-registry").HubAssetType;
  symbol: string;
  price: number;
  changePercent: number | null;
  change?: number | null;
  volume?: number | null;
  high?: number | null;
  low?: number | null;
  updatedAt?: string | number | null;
  source: string;
  fresh: boolean;
};

export async function hubPortfolioMarks(
  positions: { assetType?: string; symbol: string }[],
): Promise<{
  marks: Record<string, number>;
  rows: HubPortfolioMark[];
  sources: string[];
  byType: Record<string, number>;
}> {
  const { groupByAssetType, getAssetTypeDef } = await import("./asset-registry");
  const grouped = groupByAssetType(positions);
  const marks: Record<string, number> = {};
  const rows: HubPortfolioMark[] = [];
  const sources: string[] = [];
  const byType: Record<string, number> = {};

  const put = (row: HubPortfolioMark) => {
    const sym = row.symbol.toUpperCase();
    const composite = `${row.assetType}:${sym}`;
    marks[composite] = row.price;
    if (row.assetType === "stock" || row.assetType === "crypto") {
      marks[sym] = row.price;
    }
    rows.push(row);
    byType[row.assetType] = (byType[row.assetType] ?? 0) + 1;
  };

  const stockBudget = getAssetTypeDef("stock")?.markBudget ?? 40;
  const stockSyms = [
    ...new Set(grouped.stock.map((p) => p.symbol.trim().toUpperCase()).filter(Boolean)),
  ].slice(0, stockBudget);
  if (stockSyms.length) {
    try {
      const q = await hubVnQuotes(stockSyms);
      const src = String((q as { meta?: { source?: string } }).meta?.source ?? "vn-quotes");
      if (!sources.includes(src)) sources.push(src);
      for (const row of q.quotes ?? []) {
        const s = String(row.symbol ?? "").toUpperCase();
        const px = row.price != null ? Number(row.price) : NaN;
        if (!s || !Number.isFinite(px)) continue;
        put({
          assetType: "stock",
          symbol: s,
          price: px,
          changePercent: row.changePercent != null ? Number(row.changePercent) : null,
          change: row.change != null ? Number(row.change) : null,
          volume: row.volume != null ? Number(row.volume) : null,
          high: row.high != null ? Number(row.high) : null,
          low: row.low != null ? Number(row.low) : null,
          updatedAt: row.updatedAt ?? null,
          source: src,
          fresh: true,
        });
      }
    } catch {
      /* */
    }
  }

  const cryptoBudget = getAssetTypeDef("crypto")?.markBudget ?? 10;
  const cryptoSyms = [
    ...new Set(grouped.crypto.map((p) => p.symbol.trim().toUpperCase()).filter(Boolean)),
  ].slice(0, cryptoBudget);
  await Promise.all(
    cryptoSyms.map(async (sym) => {
      try {
        const d = (await hubCryptoDetail(sym)) as {
          lastPrice?: string | number;
          price?: number;
          priceChangePercent?: string | number;
          volume?: string | number;
          highPrice?: string | number;
          lowPrice?: string | number;
        } | null;
        const raw = d?.lastPrice ?? d?.price;
        const px = raw != null ? Number(raw) : NaN;
        if (!Number.isFinite(px) || px <= 0) return;
        if (!sources.includes("binance")) sources.push("binance");
        const chg = d?.priceChangePercent != null ? Number(d.priceChangePercent) : null;
        put({
          assetType: "crypto",
          symbol: sym.replace(/USDT$/, ""),
          price: px,
          changePercent: Number.isFinite(chg as number) ? (chg as number) : null,
          volume: d?.volume != null ? Number(d.volume) : null,
          high: d?.highPrice != null ? Number(d.highPrice) : null,
          low: d?.lowPrice != null ? Number(d.lowPrice) : null,
          source: "binance",
          fresh: true,
        });
      } catch {
        /* */
      }
    }),
  );

  const forexBudget = getAssetTypeDef("forex")?.markBudget ?? 12;
  const forexPairs = [
    ...new Set(
      grouped.forex
        .map((p) => p.symbol.trim().toUpperCase().replace(/[\/\s]/g, ""))
        .filter(Boolean),
    ),
  ].slice(0, forexBudget);
  await Promise.all(
    forexPairs.map(async (pair) => {
      try {
        const d = (await hubForexDetail(pair)) as {
          pair?: string;
          rate?: number | null;
          ts?: number;
        } | null;
        const px = d?.rate != null ? Number(d.rate) : NaN;
        if (!Number.isFinite(px) || px <= 0) return;
        if (!sources.includes("forex-feed")) sources.push("forex-feed");
        put({
          assetType: "forex",
          symbol: pair,
          price: px,
          changePercent: null,
          updatedAt: d?.ts ?? null,
          source: "forex-feed",
          fresh: true,
        });
      } catch {
        /* */
      }
    }),
  );

  if (grouped.commodity.length) {
    const wanted = new Set(
      grouped.commodity.map((p) => p.symbol.trim().toUpperCase()).filter(Boolean),
    );
    try {
      const market = (await hubCommodityMarket("all")) as {
        rows?: Array<{
          symbol?: string;
          commodity?: string;
          price?: number | null;
          changePercent?: number | null;
          change?: number | null;
          updatedAt?: string | number | null;
        }>;
        items?: Array<{
          symbol?: string;
          commodity?: string;
          price?: number | null;
          changePercent?: number | null;
        }>;
      } | null;
      const list = market?.rows ?? market?.items ?? [];
      if (!sources.includes("commodities")) sources.push("commodities");
      for (const row of list) {
        const s = String(row.symbol || row.commodity || "").toUpperCase();
        if (
          !s ||
          (wanted.size &&
            !wanted.has(s) &&
            ![...wanted].some((w) => s.includes(w) || w.includes(s)))
        ) {
          continue;
        }
        const px = row.price != null ? Number(row.price) : NaN;
        if (!Number.isFinite(px)) continue;
        put({
          assetType: "commodity",
          symbol: s,
          price: px,
          changePercent: row.changePercent != null ? Number(row.changePercent) : null,
          change: (row as { change?: number | null }).change != null
            ? Number((row as { change?: number | null }).change)
            : null,
          updatedAt: (row as { updatedAt?: string | number | null }).updatedAt ?? null,
          source: "commodities",
          fresh: true,
        });
      }
    } catch {
      /* */
    }
  }

  return { marks, rows, sources, byType };
}
