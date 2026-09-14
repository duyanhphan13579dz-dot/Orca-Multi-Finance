import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { getFinancialsForSymbol, vnProviderLayout } from "../financial";
import type { FinancialPackageMeta, GrowthSnapshot, NormalizedPeriod } from "../financial/types";
import type { FinancialHealthResult } from "../engines/fundamental";
import * as vndirect from "../providers/vndirect";
import {
  getSsiDailyOhlc,
  getSsiFullBoard,
  getSsiIndices,
  getSsiQuotes,
  getSsiUniverse,
  ssiFcConfigured,
} from "../providers/ssi-fcdata";
import { validateBars, logQualityEvent } from "../quality";
import { analyzeSeries, detectPatterns } from "../technical";
import type { CandlePattern, IndexQuote, Meta, OhlcvBar, Quote, TechnicalSnapshot } from "../types";

const INDEX_PRIORITY = ["VNINDEX", "VN30", "HNX", "UPCOM", "HNX30", "VN100"];

function sortIndices(items: IndexQuote[]): IndexQuote[] {
  return [...items].sort((a, b) => {
    const ia = INDEX_PRIORITY.indexOf(a.code);
    const ib = INDEX_PRIORITY.indexOf(b.code);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

export function vnMarketConfigured(): boolean {
  return true;
}

export function vnstockConfigured(): boolean {
  return vnMarketConfigured();
}

// Single routing contract: VNDirect is primary; SSI is fallback only.
export function vnPrimaryProvider(): "ssi-fcdata" | "vndirect" {
  return vnProviderLayout().market.primary === "vndirect" ? "vndirect" : "ssi-fcdata";
}

export async function getVnIndices(): Promise<{ items: IndexQuote[]; meta: Meta } | null> {
  try {
    const res = await cached("vn:indices:vnd:v2", {
      ttlMs: 30_000,
      staleMs: 90_000,
      producer: () => vndirect.getVndIndices(),
    });
    return {
      items: sortIndices(res.value.items),
      meta: buildMeta({
        source: "vndirect",
        sourceTimestampMs: res.value.sourceTs,
        cached: res.cached,
        note: "VNDirect primary · SSI fallback only",
      }),
    };
  } catch {
    // SSI remains a bounded fallback when VNDirect is unavailable.
    if (ssiFcConfigured()) {
      try {
        const res = await cached("vn:indices:ssi:fallback:v1", {
          ttlMs: 20_000,
          staleMs: 60_000,
          producer: async () => getSsiIndices(INDEX_PRIORITY),
        });
        return {
          items: sortIndices(res.value.items),
          meta: buildMeta({ source: "ssi-fcdata-fallback", sourceTimestampMs: res.value.sourceTs, cached: res.cached, degraded: true, note: "VNDirect unavailable; SSI fallback" }),
        };
      } catch {
        return null;
      }
    }
    return null;
  }
}
export async function getVnMarketBoard(): Promise<{
  quotes: Quote[];
  indices: IndexQuote[];
  universeSize: number;
  sessionDate: string;
  meta: Meta;
} | null> {
  try {
    const [mq, idx] = await Promise.all([
      cached("vn:market-board:vnd:v2", {
        ttlMs: 30_000,
        staleMs: 90_000,
        producer: () => vndirect.getVndMarketQuotes(),
      }),
      getVnIndices(),
    ]);
    return {
      quotes: mq.value.quotes,
      indices: idx?.items ?? [],
      universeSize: mq.value.quotes.length,
      sessionDate: mq.value.sessionDate,
      meta: buildMeta({
        source: "vndirect",
        sourceTimestampMs: mq.value.sourceTs,
        cached: mq.cached,
        degraded: !idx,
        partial: !idx,
        note: "VNDirect primary · SSI fallback only",
      }),
    };
  } catch {
    // SSI REST is fallback only; realtime orderbook remains served independently by SSI WS.
    if (!ssiFcConfigured()) return null;
    try {
      const [board, indices] = await Promise.all([
        getSsiFullBoard(),
        getSsiIndices(INDEX_PRIORITY).catch(() => ({ items: [] as IndexQuote[], sourceTs: null as number | null })),
      ]);
      return {
        quotes: board.quotes,
        indices: sortIndices(indices.items),
        universeSize: board.quotes.length,
        sessionDate: board.sessionDate,
        meta: buildMeta({ source: "ssi-fcdata-fallback", sourceTimestampMs: board.sourceTs, degraded: true, note: "VNDirect unavailable; SSI fallback" }),
      };
    } catch {
      return null;
    }
  }
}
export async function getVnUniverseList(): Promise<{
  items: { symbol: string; name: string | null; exchange: string | null; industry: string | null; sources?: string[]; conflicts?: string[] }[];
  meta: Meta;
} | null> {
  try {
    const items = await vndirect.getVndUniverse();
    return {
      items,
      meta: buildMeta({
        source: "vndirect",
        sourceTimestampMs: Date.now(),
        note: `VNDirect security master primary: ${items.length} mã`,
      }),
    };
  } catch {
    try {
      const res = await cached("vn:universe:ssi:fallback:v1", {
        ttlMs: 6 * 3_600_000,
        staleMs: 24 * 3_600_000,
        producer: () => getSsiUniverse(),
      });
      return {
        items: res.value,
        meta: buildMeta({ source: "ssi-fcdata-fallback", sourceTimestampMs: Date.now(), cached: res.cached, degraded: true, note: "VNDirect unavailable; SSI security master fallback" }),
      };
    } catch {
      return null;
    }
  }
}

export async function getVnQuotes(symbols: string[]): Promise<{ quotes: Quote[]; meta: Meta } | null> {
  if (!symbols.length) return null;
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))].slice(0, 40);
  try {
    const v = await vndirect.getVndQuotes(uniq);
    const bySymbol = new Map(v.quotes.map((q) => [q.symbol, q]));
    const quotes = uniq.map((symbol) => bySymbol.get(symbol)).filter((q): q is Quote => Boolean(q));
    return {
      quotes,
      meta: buildMeta({ source: "vndirect", sourceTimestampMs: v.sourceTs, note: "VNDirect quotes primary · SSI fallback only" }),
    };
  } catch {
    if (!ssiFcConfigured()) return null;
    try {
      const r = await getSsiQuotes(uniq);
      return { quotes: r.quotes, meta: buildMeta({ source: "ssi-fcdata-fallback", sourceTimestampMs: r.sourceTs, degraded: true, note: "VNDirect unavailable; SSI fallback" }) };
    } catch {
      return null;
    }
  }
}
export async function getVnOhlcv(
  symbol: string,
  limit = 250,
): Promise<{ bars: OhlcvBar[]; meta: Meta } | null> {
  const sym = symbol.toUpperCase();
  const isIndex = vndirect.isVnIndexSymbol(sym);

  try {
    const rawBars = isIndex
      ? await vndirect.getVndIndexOhlcv(sym, limit)
      : await vndirect.getVndOhlcv(sym, limit);
    const quality = validateBars(rawBars);
    if (quality.status === "INVALID") throw new Error(`vndirect invalid ohlcv: ${sym}`);
    if (quality.status !== "VALID") void logQualityEvent("vndirect", `ohlcv:${sym}`, quality);
    return {
      bars: quality.cleaned.slice(-limit),
      meta: buildMeta({ source: "vndirect", sourceTimestampMs: Date.now(), note: "VNDirect OHLCV primary · normalized and quality-checked" }),
    };
  } catch {
    if (!ssiFcConfigured()) return null;
    try {
      const res = await cached(`vn:ohlcv:ssi:fallback:${sym}:${limit}`, {
        ttlMs: 60_000,
        staleMs: 180_000,
        producer: async () => {
          const bars = await getSsiDailyOhlc(sym);
          if (!bars.length) throw new Error("ssi empty ohlc");
          return bars;
        },
      });
      const bars = res.value.slice(-limit);
      const q = validateBars(bars);
      if (q.status !== "VALID") void logQualityEvent("ssi-fcdata-fallback", `ohlcv:${sym}`, q);
      if (q.status === "INVALID") return null;
      return { bars: q.cleaned, meta: buildMeta({ source: "ssi-fcdata-fallback", sourceTimestampMs: Date.now(), cached: res.cached, degraded: true, note: "VNDirect unavailable; SSI OHLCV fallback · normalized and quality-checked" }) };
    } catch {
      return null;
    }
  }
}

export interface VnStockDetail {
  symbol: string;
  quote: Quote | null;
  bars: OhlcvBar[];
  technical: TechnicalSnapshot | null;
  patterns: CandlePattern[];
  financials: {
    income: Record<string, unknown>[] | null;
    balance: Record<string, unknown>[] | null;
    cashflow: Record<string, unknown>[] | null;
    ratios: Record<string, unknown>[] | null;
  };
  financialHealth: FinancialHealthResult | null;
  financialMeta: FinancialPackageMeta | null;
  financialGrowth: GrowthSnapshot | null;
  financialTtm: NormalizedPeriod | null;
  notes: string[];
}

export async function getVnStockDetail(
  symbol: string,
): Promise<{ detail: VnStockDetail; meta: Meta } | null> {
  const sym = symbol.toUpperCase();
  const failed: string[] = [];
  const notes: string[] = [];

  let quote: Quote | null = null;
  let quoteSource = "";
  try {
    const q = await getVnQuotes([sym]);
    if (q?.quotes[0]) {
      quote = q.quotes[0];
      quoteSource = q.meta.source;
    } else failed.push("quote");
  } catch {
    failed.push("quote");
  }

  let bars: OhlcvBar[] = [];
  let ohlcvSource = "";
  try {
    const o = await getVnOhlcv(sym, 180);
    if (o?.bars.length) {
      bars = o.bars;
      ohlcvSource = o.meta.source;
    } else failed.push("ohlcv");
  } catch {
    failed.push("ohlcv");
  }

  let technical: TechnicalSnapshot | null = null;
  let patterns: CandlePattern[] = [];
  if (bars.length >= 20) {
    try {
      technical = analyzeSeries(bars);
      patterns = detectPatterns(bars);
    } catch {
      /* ignore */
    }
  }

  let fin: Awaited<ReturnType<typeof getFinancialsForSymbol>> | null = null;
  try {
    fin = await getFinancialsForSymbol(sym);
  } catch {
    failed.push("financials");
  }

  if (failed.length) notes.push(`Thiếu: ${[...new Set(failed)].join(", ")}`);

  const detail: VnStockDetail = {
    symbol: sym,
    quote,
    bars,
    technical,
    patterns,
    financials: fin?.financials ?? { income: null, balance: null, cashflow: null, ratios: null },
    financialHealth: fin?.health ?? null,
    financialMeta: fin?.packageMeta ?? null,
    financialGrowth: fin?.growth ?? null,
    financialTtm: fin?.ttm ?? null,
    notes,
  };

  return {
    detail,
    meta: buildMeta({
      source:
        [quoteSource, ohlcvSource, fin?.packageMeta?.primarySource].filter(Boolean).join("+") ||
        (ssiFcConfigured() ? "ssi-fcdata" : "vndirect"),
      sourceTimestampMs: Date.now(),
      degraded: failed.length > 0,
      partial: failed.length > 0,
      note: notes[0],
    }),
  };
}

export { getVnOrderBook, type VnOrderBook } from "./stock-orderbook";
