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
  ssiFcConfigured,
} from "../providers/ssi-fcdata";
import { ensureSsiWsStarted, ssiWs } from "../realtime/ssi-ws";
import { bootSsiMarketDataPipeline } from "../realtime/ssi-market-boot";
import { getCanonicalSecurityMaster, toCanonicalUniverse } from "../vn/security-master";
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

function bootSsiLive() {
  if (!ssiFcConfigured()) return;
  if (process.env.SSI_WS_DISABLED === "true") return;
  try {
    bootSsiMarketDataPipeline();
  } catch {
    try {
      ensureSsiWsStarted();
    } catch {
      /* non-fatal */
    }
  }
}

export function vnMarketConfigured(): boolean {
  return true;
}

export function vnstockConfigured(): boolean {
  return vnMarketConfigured();
}

// Map provider ưu tiên hiện tại — SSI Flashconnect làm primary khi đã cấu hình.
export function vnPrimaryProvider(): "ssi-fcdata" | "vndirect" {
  // VNDirect is primary for daily/history market data; SSI only supplies realtime overlay/fallback.
  return vnProviderLayout().market.primary === "ssi-fcdata" ? "ssi-fcdata" : "vndirect";
}

function liveQuoteFromWs(symbol: string): Quote | null {
  const t = ssiWs.getQuote(symbol, 30_000);
  if (!t) return null;
  return {
    symbol: t.symbol,
    assetClass: "stock",
    price: t.price,
    change: t.change,
    changePercent: t.changePercent,
    open: t.open,
    high: t.high,
    low: t.low,
    volume: t.volume,
    quoteVolume: t.value,
    referencePrice: t.ref,
    ceilingPrice: t.ceiling,
    floorPrice: t.floor,
    updatedAt: new Date(t.eventTime).toISOString(),
  };
}

export async function getVnIndices(): Promise<{ items: IndexQuote[]; meta: Meta } | null> {
  bootSsiLive();
  try {
    const res = await cached("vn:indices:vnd:v2", {
      ttlMs: 30_000,
      staleMs: 90_000,
      producer: () => vndirect.getVndIndices(),
    });
    const live = res.value.items.map((item) => {
      const tick = ssiWs.getIndex(item.code, 30_000);
      return tick
        ? {
            ...item,
            value: tick.value,
            change: tick.change ?? item.change,
            changePercent: tick.changePercent ?? item.changePercent,
            volume: tick.volume ?? item.volume,
            updatedAt: new Date(tick.eventTime).toISOString(),
          }
        : item;
    });
    const hasLive = live.some((item, i) => item.updatedAt !== res.value.items[i]?.updatedAt);
    return {
      items: sortIndices(live),
      meta: buildMeta({
        source: hasLive ? "vndirect+ssi-ws-realtime" : "vndirect",
        sourceTimestampMs: hasLive ? Date.now() : res.value.sourceTs,
        cached: res.cached,
        note: hasLive ? "VNDirect primary · SSI realtime index overlay" : "VNDirect market indices",
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
  bootSsiLive();
  try {
    const [mq, idx] = await Promise.all([
      cached("vn:market-board:vnd:v2", {
        ttlMs: 30_000,
        staleMs: 90_000,
        producer: () => vndirect.getVndMarketQuotes(),
      }),
      getVnIndices(),
    ]);
    const quotes = mq.value.quotes.map((quote) => liveQuoteFromWs(quote.symbol) ?? quote);
    const hasLive = quotes.some((quote, i) => quote.updatedAt !== mq.value.quotes[i]?.updatedAt);
    return {
      quotes,
      indices: idx?.items ?? [],
      universeSize: quotes.length,
      sessionDate: mq.value.sessionDate,
      meta: buildMeta({
        source: hasLive ? "vndirect+ssi-ws-realtime" : "vndirect",
        sourceTimestampMs: hasLive ? Date.now() : mq.value.sourceTs,
        cached: mq.cached,
        degraded: !idx,
        partial: !idx,
        note: hasLive ? "VNDirect primary · SSI realtime quote overlay" : "VNDirect market board",
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
        quotes: board.quotes.map((q) => liveQuoteFromWs(q.symbol) ?? q),
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
    const records = await getCanonicalSecurityMaster();
    return {
      items: toCanonicalUniverse(records),
      meta: buildMeta({
        source: "ssi-vndirect-canonical",
        sourceTimestampMs: Date.now(),
        note: `Canonical master: ${records.length} mã, merge SSI ưu tiên tên/sàn và VNDIRECT bổ sung ngành`,
      }),
    };
  } catch {
    // Preserve the old provider fallback if both security-master sources are unavailable.
    try {
      const res = await cached("vn:universe:vnd:fallback:v1", {
        ttlMs: 6 * 3_600_000,
        staleMs: 24 * 3_600_000,
        producer: () => vndirect.getVndUniverse(),
      });
      return {
        items: res.value,
        meta: buildMeta({ source: "vndirect", sourceTimestampMs: Date.now(), cached: res.cached, note: "Canonical master unavailable; provider fallback" }),
      };
    } catch {
      return null;
    }
  }
}

export async function getVnQuotes(symbols: string[]): Promise<{ quotes: Quote[]; meta: Meta } | null> {
  if (!symbols.length) return null;
  bootSsiLive();
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))].slice(0, 40);
  try {
    const v = await vndirect.getVndQuotes(uniq);
    const bySymbol = new Map(v.quotes.map((q) => [q.symbol, q]));
    let hasLive = false;
    for (const symbol of uniq) {
      const live = liveQuoteFromWs(symbol);
      if (live) {
        bySymbol.set(symbol, live);
        hasLive = true;
      }
    }
    const quotes = uniq.map((symbol) => bySymbol.get(symbol)).filter((q): q is Quote => Boolean(q));
    return {
      quotes,
      meta: buildMeta({ source: hasLive ? "vndirect+ssi-ws-realtime" : "vndirect", sourceTimestampMs: hasLive ? Date.now() : v.sourceTs, note: hasLive ? "VNDirect primary · SSI realtime quote overlay" : "VNDirect quotes" }),
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
  bootSsiLive();
  const isIndex = vndirect.isVnIndexSymbol(sym);
  if (ssiFcConfigured() && !isIndex) ssiWs.watchSymbol(sym);

  try {
    const bars = isIndex
      ? await vndirect.getVndIndexOhlcv(sym, limit)
      : await vndirect.getVndOhlcv(sym, limit);
    return {
      bars,
      meta: buildMeta({ source: "vndirect", sourceTimestampMs: Date.now(), note: "VNDirect OHLCV primary" }),
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
      return { bars, meta: buildMeta({ source: "ssi-fcdata-fallback", sourceTimestampMs: Date.now(), cached: res.cached, degraded: true, note: "VNDirect unavailable; SSI OHLCV fallback" }) };
    } catch {
      return null;
    }
  }
}

export interface VnStockDetail {
  symbol: string;
  exchange: string | null;
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
  bootSsiLive();
  let exchange: string | null = null;
  try {
    exchange = (await getCanonicalSecurityMaster()).find((item) => item.symbol === sym)?.exchange ?? null;
  } catch {
    /* exchange metadata is optional for the stock detail response */
  }
  ssiWs.watchSymbol(sym);
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
    exchange,
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
