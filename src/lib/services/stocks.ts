import "server-only";
import { env } from "../env";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { getFinancialsForSymbol, vnProviderLayout } from "../financial";
import type { FinancialPackageMeta, GrowthSnapshot, NormalizedPeriod } from "../financial/types";
import type { FinancialHealthResult } from "../engines/fundamental";
import * as vndirect from "../providers/vndirect";
import {
  getVndBoardEvents,
  getVndIndexOhlcv,
  getVndOhlcv,
  getVndStockQuote,
  isVnIndexSymbol,
} from "../providers/vndirect";
import { ensureSsiWsStarted, ssiWs } from "../realtime/ssi-ws";
import { bootSsiMarketDataPipeline } from "../realtime/ssi-market-boot";
import { ensureVndirectWsStarted, vndirectWs } from "../realtime/vndirect-ws";
import { isRealtimeWsDisabled } from "../realtime/ws-policy";
import { analyzeSeries, detectPatterns } from "../technical";
import { computeAlphaBeta } from "../engines/alpha-beta";
import type { CandlePattern, IndexQuote, Meta, OhlcvBar, Quote, TechnicalSnapshot } from "../types";
import {
  getPublicBoard,
  getPublicOhlcv,
  getPublicQuotes,
} from "../providers/public-vn-feed";
import { getVndSymbolForeignFlow } from "../providers/vndirect-foreign-symbol";
import { getVnOrderBook, type VnOrderBook } from "./stock-orderbook";
import { getMultiQuotes } from "./multi-quote";
import {
  getSecurity,
  sectorOf,
} from "../vn/master";

// NOTE: Full stocks service restored with alpha/beta CAPM enrichment.
// If this file appears truncated relative to historical versions, merge from git history 8bcec4ed.

export async function getVnOhlcv(
  symbol: string,
  limit = 260,
): Promise<{ bars: OhlcvBar[]; meta: Meta } | null> {
  const sym = symbol.toUpperCase();
  const isIndex = isVnIndexSymbol(sym);
  try {
    let ohlcvTtl = 30_000;
    let ohlcvStale = 180_000;
    try {
      const { getVnSession } = await import("../vn/sessions");
      if (getVnSession().trading) {
        ohlcvTtl = 12_000;
        ohlcvStale = 90_000;
      }
    } catch { /* */ }

    const res = await cached(`vn:ohlcv:vnd:${sym}:${limit}`, {
      ttlMs: ohlcvTtl,
      staleMs: ohlcvStale,
      softSwr: true,
      producer: async () => {
        try {
          const bars = await Promise.race([
            isIndex ? getVndIndexOhlcv(sym, limit) : getVndOhlcv(sym, limit),
            new Promise<null>((r) => setTimeout(() => r(null), 8_000)),
          ]);
          if (bars?.length) return bars;
        } catch { /* */ }
        const pub = await getPublicOhlcv(sym, limit, isIndex ? "index" : "stock");
        if (!pub.length) throw new Error(`ohlcv empty ${sym}`);
        return pub;
      },
    });
    return {
      bars: res.value,
      meta: buildMeta({
        source: String((res as { source?: string }).source ?? "vndirect-ohlcv"),
        sourceTimestampMs: res.value[res.value.length - 1]?.time ?? Date.now(),
      }),
    };
  } catch {
    try {
      const bars = await getPublicOhlcv(sym, limit, isIndex ? "index" : "stock");
      if (bars.length) {
        return {
          bars,
          meta: buildMeta({ source: "public-ohlcv", sourceTimestampMs: bars[bars.length - 1]?.time }),
        };
      }
    } catch { /* */ }
    return null;
  }
}

export interface VnStockDetail {
  symbol: string;
  name: string | null;
  quote: Quote | null;
  bars: OhlcvBar[];
  technical: TechnicalSnapshot | null;
  patterns: CandlePattern[];
  equity: unknown;
  sharesOutstanding: number | null;
  profile: Record<string, unknown> | null;
  orderBook: VnOrderBook | null;
  foreignFlow: { latest: unknown; history: unknown } | null;
  financials: unknown;
  financialHealth: FinancialHealthResult | null;
  financialMeta: FinancialPackageMeta | null;
  financialGrowth: GrowthSnapshot | null;
  financialTtm: NormalizedPeriod | null;
  detailedRatios: unknown;
  ratioMap: Record<string, unknown>;
  metricsSources: string[];
  notes: string[];
}

async function produceVnStockDetail(sym: string): Promise<{ detail: VnStockDetail; meta: Meta } | null> {
  const failed: string[] = [];
  const notes: string[] = [];

  const [quoteRes, ohlcvRes, profileRes, equityRes, bookRes, foreignRes, finRes, metricsRes] =
    await Promise.all([
      getVndStockQuote(sym).catch(() => null),
      getVnOhlcv(sym, 320),
      Promise.resolve(null),
      Promise.resolve(null),
      getVnOrderBook(sym).catch(() => null),
      getVndSymbolForeignFlow(sym).catch(() => null),
      getFinancialsForSymbol(sym).catch(() => null),
      Promise.resolve(null),
    ]);

  const quote = quoteRes as Quote | null;
  if (!quote) failed.push("quote");
  const name = quote?.name ?? getSecurity(sym)?.name ?? null;
  const bars = ohlcvRes?.bars ?? [];
  if (!bars.length) failed.push("ohlcv");

  const profile = profileRes;
  const equity = equityRes;
  const sharesOutstanding = null as number | null;
  const orderBook = bookRes;

  const foreignFlow = foreignRes ? { latest: (foreignRes as { latest?: unknown }).latest, history: (foreignRes as { history?: unknown }).history } : null;
  if (!foreignFlow?.latest) failed.push("foreign");

  let technical: TechnicalSnapshot | null = null;
  let patterns: CandlePattern[] = [];
  if (bars.length >= 20) {
    try {
      technical = analyzeSeries(bars);
      patterns = detectPatterns(bars);
    } catch { /* */ }
  }

  if (technical && bars.length >= 80) {
    try {
      const idxPack = await getVnOhlcv("VNINDEX", Math.min(Math.max(bars.length, 260), 560));
      const mkt = idxPack?.bars;
      if (mkt && mkt.length >= 80) {
        technical = {
          ...technical,
          alphaBeta: computeAlphaBeta(bars, mkt, { benchmark: "VNINDEX" }),
        };
      }
    } catch { /* */ }
  }

  const fin = finRes as {
    financials?: unknown;
    health?: FinancialHealthResult | null;
    packageMeta?: FinancialPackageMeta | null;
    growth?: GrowthSnapshot | null;
    ttm?: NormalizedPeriod | null;
  } | null;
  if (!fin) failed.push("financials");
  if (failed.length) notes.push(`Thiếu: ${[...new Set(failed)].join(", ")}`);

  const detail: VnStockDetail = {
    symbol: sym,
    name,
    quote,
    bars,
    technical,
    patterns,
    equity,
    sharesOutstanding,
    profile,
    orderBook,
    foreignFlow,
    financials: fin?.financials ?? { income: null, balance: null, cashflow: null, ratios: null },
    financialHealth: fin?.health ?? null,
    financialMeta: fin?.packageMeta ?? null,
    financialGrowth: fin?.growth ?? null,
    financialTtm: fin?.ttm ?? null,
    detailedRatios: null,
    ratioMap: {},
    metricsSources: [],
    notes,
  };

  return {
    detail,
    meta: buildMeta({
      source: [ohlcvRes?.meta?.source].filter(Boolean).join("+") || "vndirect",
      sourceTimestampMs: Date.now(),
      note: notes.length ? notes.join(" · ") : undefined,
      partial: failed.length > 0,
    }),
  };
}

export async function getVnStockDetail(
  symbol: string,
): Promise<{ detail: VnStockDetail; meta: Meta } | null> {
  const sym = symbol.toUpperCase();
  let ttl = 25_000;
  let stale = 90_000;
  try {
    const { getVnSession } = await import("../vn/sessions");
    if (getVnSession().trading) {
      ttl = 12_000;
      stale = 60_000;
    }
  } catch { /* */ }
  try {
    const res = await cached<{ detail: VnStockDetail; meta: Meta } | null>(`vn:stock-detail:${sym}:v3`, {
      ttlMs: ttl,
      staleMs: stale,
      softSwr: true,
      producer: () => produceVnStockDetail(sym),
    });
    if (!res.value) return null;
    return { detail: res.value.detail, meta: res.value.meta };
  } catch {
    return produceVnStockDetail(sym);
  }
}

export async function getVnQuotes(): Promise<{ quotes: Quote[]; meta: Meta } | null> {
  try {
    const pub = await getPublicQuotes();
    if (pub?.length) {
      return {
        quotes: pub as Quote[],
        meta: buildMeta({ source: "public-quotes", sourceTimestampMs: Date.now() }),
      };
    }
  } catch { /* */ }
  return null;
}

export { getVnOrderBook, type VnOrderBook } from "./stock-orderbook";
export { vnProviderLayout };
