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
 * so valuation / agent / screener / CANSLIM share one fetch per key per request.
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
 * Wraps existing financial/service.getFinancialPackage.
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
  sourceTs?: number | null;
  meta?: { freshness?: string; source?: string } | null;
  sessionDate?: string;
};

function normalizeQuotes(r: unknown, source: string): HubVnQuotesResult | null {
  if (Array.isArray(r)) {
    return { quotes: r as unknown as HubVnQuote[], sourceTs: null, meta: { source } };
  }
  if (r && typeof r === "object") {
    const o = r as HubVnQuotesResult & { quotes?: HubVnQuote[] };
    if (Array.isArray(o.quotes)) {
      return {
        quotes: o.quotes as unknown as HubVnQuote[],
        sourceTs: o.sourceTs ?? null,
        meta: { ...(typeof o.meta === "object" && o.meta ? o.meta : {}), source },
      };
    }
  }
  return null;
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

/**
 * News bundle — optional symbol filter.
 * Aggregates RSS once per request; filters offline when symbol given.
 */
export async function hubNews(opts?: { symbol?: string; limit?: number }) {
  const sym = opts?.symbol?.trim().toUpperCase() ?? "";
  const limit = opts?.limit ?? 8;
  const key = kNews(sym ? `sym:${sym}:L${limit}` : `all:L${limit}`);
  return coalesce(key, async () => {
    const { aggregateNews } = await import("../providers/news");
    const { articles, errors } = await aggregateNews();
    let list = articles;
    if (sym) {
      list = articles.filter(
        (a) =>
          (a.relatedSymbols ?? []).some((s) => s.toUpperCase() === sym) ||
          new RegExp(`\\b${sym}\\b`, "i").test(`${a.title ?? ""} ${a.summary ?? ""}`),
      );
    }
    return {
      articles: list.slice(0, limit),
      errors,
      total: articles.length,
      filtered: Boolean(sym),
    };
  }, { sourceIds: ["news-bundle", "cafef"] });
}

/** Macro / economic series by id (structured). */
export async function hubMacro(id: string) {
  return coalesce(kMacro(id), async () => {
    try {
      const mod = (await import("../services/economy")) as unknown as {
        getEconomicData?: (id: string) => Promise<unknown>;
      };
      if (typeof mod.getEconomicData === "function") {
        return mod.getEconomicData(id);
      }
    } catch {
      /* optional */
    }
    return null;
  }, { sourceIds: ["economic-data"] });
}

/**
 * Cross-check helper: compare two numeric fields already in the hub bag.
 */
export function hubCrossCheckNumbers(
  pairs: Array<{ label: string; a: number | null | undefined; b: number | null | undefined; tolPct?: number }>,
): { ok: boolean; details: Array<{ label: string; ok: boolean; a: number | null; b: number | null }> } {
  const details = pairs.map(({ label, a, b, tolPct = 2 }) => {
    const na = a == null || !Number.isFinite(a) ? null : a;
    const nb = b == null || !Number.isFinite(b) ? null : b;
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
