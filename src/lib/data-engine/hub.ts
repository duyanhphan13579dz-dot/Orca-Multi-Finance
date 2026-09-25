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
  const list = Array.isArray(r.quotes) ? r.quotes : Array.isArray(r.data) ? r.data : Array.isArray(raw) ? (raw as HubVnQuote[]) : null;
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
  return coalesce(key, async (): Promise<HubVnQuotesResult> => {
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
  }, { sourceIds: ["vndirect", "ssi-fcdata", "stocks-service"] });
}

export function hubVnQuotesPeek(symbols: string[]) {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].sort();
  return hubPeek(kQuote(uniq.join(",")));
}

/** Crypto spot ticker (Binance primary). */
export async function hubCryptoDetail(symbol: string) {
  const sym = symbol.trim().toUpperCase().replace(/USDT$/, "") + "USDT";
  return coalesce(kCrypto(sym), async () => {
    return withTimeout(3_500, async () => {
      const { getSpotTicker } = await import("../providers/binance");
      return getSpotTicker(sym);
    }, "hubCryptoDetail");
  }, { sourceIds: ["binance"] });
}

/** Forex pair rate. */
export async function hubForexDetail(pair: string) {
  const p = pair.trim().toUpperCase().replace(/[\/\s]/g, "");
  return coalesce(kForex(p), async () => {
    return withTimeout(3_500, async () => {
      const { getBiquoteQuotes } = await import("../providers/forex");
      const r = await getBiquoteQuotes([p]);
      return { pair: p, rate: r.rates[p] ?? null, ts: r.ts, rates: r.rates };
    }, "hubForexDetail");
  }, { sourceIds: ["forex-feed"] });
}

/** Commodity market snapshot (VietnamBiz goods). */
export async function hubCommodityMarket(id = "all") {
  const key = kCommodity(id || "all");
  return coalesce(key, async () => {
    return withTimeout(4_500, async () => {
      const { fetchVietnambizGoods } = await import("../providers/commodities");
      return fetchVietnambizGoods();
    }, "hubCommodityMarket");
  }, { sourceIds: ["commodities"] });
}

/** News feed via shared key. */
export async function hubNews(opts?: { symbol?: string; limit?: number }) {
  const q = opts?.symbol ? `sym:${opts.symbol}` : "general";
  return coalesce(kNews(q), async () => {
    return withTimeout(5_000, async () => {
      const { getNews } = await import("../services/news");
      return getNews({ symbol: opts?.symbol, limit: opts?.limit ?? 10 });
    }, "hubNews");
  }, { sourceIds: ["news"] });
}

/** Macro / rates snapshot by id. */
export async function hubMacro(id: string) {
  return coalesce(kMacro(id), async () => {
    return withTimeout(5_000, async () => {
      const { getEconomyBundle } = await import("../services/economy").catch(() => ({ getEconomyBundle: null }));
      if (!getEconomyBundle) throw new Error("economy_unavailable");
      return getEconomyBundle();
    }, "hubMacro");
  }, { sourceIds: ["macro"] });
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
 * Smart Portfolio → Data Hub: marks for open positions from shared market sources.
 * Prefer this over calling stocks/crypto services directly from portfolio modules.
 */
export async function hubPortfolioMarks(
  positions: { assetType?: string; symbol: string }[],
): Promise<{ marks: Record<string, number>; sources: string[] }> {
  const marks: Record<string, number> = {};
  const sources: string[] = [];
  const stockSyms = [
    ...new Set(
      positions
        .filter((p) => (p.assetType ?? "stock") === "stock")
        .map((p) => p.symbol.trim().toUpperCase())
        .filter(Boolean),
    ),
  ].slice(0, 40);
  if (stockSyms.length) {
    try {
      const q = await hubVnQuotes(stockSyms);
      sources.push(String(q.meta?.source ?? "vn-quotes"));
      for (const row of q.quotes ?? []) {
        const s = String(row.symbol ?? "").toUpperCase();
        const px = row.price != null ? Number(row.price) : NaN;
        if (s && Number.isFinite(px)) marks[s] = px;
      }
    } catch {
      /* */
    }
  }
  const cryptoSyms = [
    ...new Set(
      positions
        .filter((p) => p.assetType === "crypto")
        .map((p) => p.symbol.trim().toUpperCase())
        .filter(Boolean),
    ),
  ].slice(0, 8);
  for (const sym of cryptoSyms) {
    try {
      const d = (await hubCryptoDetail(sym)) as { lastPrice?: string | number } | null;
      const px = d?.lastPrice != null ? Number(d.lastPrice) : NaN;
      if (Number.isFinite(px) && px > 0) {
        marks[sym] = px;
        if (!sources.includes("binance")) sources.push("binance");
      }
    } catch {
      /* */
    }
  }
  return { marks, sources };
}
