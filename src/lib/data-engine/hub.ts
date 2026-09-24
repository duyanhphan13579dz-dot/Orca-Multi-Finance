import "server-only";
import { coalesce, hubPeek } from "./coalesce";
import { hubStats, runInDataHub } from "./request-scope";
import { catalogSummary, SOURCE_CATALOG } from "./catalog";

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
    const { getFinancialPackage } = await import("../financial/service");
    return getFinancialPackage(sym);
  }, { sourceIds: ["vndirect-fs"] });
}

/** Peek financial package if already loaded in this request (no network). */
export function hubFinancialPackagePeek(symbol: string) {
  return hubPeek(kFin(symbol.trim().toUpperCase()));
}

/**
 * VN market quotes — batch singleflight.
 * Key is sorted symbol list so agent + valuation + screener share one call.
 */
export type HubVnQuote = {
  symbol?: string;
  price?: number | null;
  [key: string]: unknown;
};

export type HubVnQuotesResult = {
  quotes: HubVnQuote[];
  sourceTs?: number | null;
  meta?: unknown;
  sessionDate?: string;
};

export async function hubVnQuotes(symbols: string[]): Promise<HubVnQuotesResult> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].sort();
  if (!uniq.length) return { quotes: [], sourceTs: null, meta: null };
  const key = kQuote(uniq.join(","));
  return coalesce(key, async (): Promise<HubVnQuotesResult> => {
    // Prefer multi-source path when services/stocks exists; else VNDIRECT primary.
    try {
      const stocks = (await import("../services/stocks").catch(() => null)) as unknown as {
        getVnQuotes?: (s: string[]) => Promise<unknown>;
      } | null;
      if (stocks && typeof stocks.getVnQuotes === "function") {
        const r = await stocks.getVnQuotes(uniq);
        if (Array.isArray(r)) {
          return { quotes: r as HubVnQuote[], sourceTs: null };
        }
        if (r && typeof r === "object" && Array.isArray((r as HubVnQuotesResult).quotes)) {
          return r as HubVnQuotesResult;
        }
      }
    } catch {
      /* fall through */
    }
    const { getVndQuotes } = await import("../providers/vndirect");
    const r = await getVndQuotes(uniq);
    return {
      quotes: (r.quotes ?? []) as HubVnQuote[],
      sourceTs: r.sourceTs ?? null,
      meta: r.sourceTs != null ? { freshness: "FRESH" as const } : null,
    };
  }, { sourceIds: ["vndirect", "ssi-fcdata"] });
}

export function hubVnQuotesPeek(symbols: string[]) {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].sort();
  return hubPeek(kQuote(uniq.join(",")));
}

/** Crypto spot ticker (Binance primary). */
export async function hubCryptoDetail(symbol: string) {
  const sym = symbol.trim().toUpperCase().replace(/USDT$/, "") + "USDT";
  return coalesce(kCrypto(sym), async () => {
    const { getSpotTicker } = await import("../providers/binance");
    return getSpotTicker(sym);
  }, { sourceIds: ["binance"] });
}

/** Forex pair rate. */
export async function hubForexDetail(pair: string) {
  const p = pair.trim().toUpperCase().replace(/[\/\s]/g, "");
  return coalesce(kForex(p), async () => {
    const { getBiquoteQuotes } = await import("../providers/forex");
    const r = await getBiquoteQuotes([p]);
    return { pair: p, rate: r.rates[p] ?? null, ts: r.ts, rates: r.rates };
  }, { sourceIds: ["forex-feed"] });
}

/** Commodity market snapshot (VietnamBiz goods). */
export async function hubCommodityMarket(id = "all") {
  const key = kCommodity(id || "all");
  return coalesce(key, async () => {
    const { fetchVietnambizGoods } = await import("../providers/commodities");
    return fetchVietnambizGoods();
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
    // Load via services/economy when present; avoid static type coupling.
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
 * Returns agreement ratio for diagnostics (modules verify each other offline).
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

export const HubKeys = {
  financial: kFin,
  quote: kQuote,
  crypto: kCrypto,
  forex: kForex,
  commodity: kCommodity,
  news: kNews,
  macro: kMacro,
};
