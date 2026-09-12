import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { getFinancialsForSymbol } from "../financial/service";
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
import { ensureSsiWsStarted, ssiWs } from "../realtime/ssi-ws";
import { bootSsiMarketDataPipeline } from "../realtime/ssi-market-boot";
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

export function vnPrimaryProvider(): "ssi-fcdata" | "vndirect" {
  return ssiFcConfigured() ? "ssi-fcdata" : "vndirect";
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
  if (ssiFcConfigured() && process.env.SSI_WS_DISABLED !== "true") {
    const live: IndexQuote[] = [];
    for (const code of INDEX_PRIORITY) {
      const idx = ssiWs.getIndex(code, 30_000);
      if (!idx) continue;
      live.push({
        code: idx.code,
        name: idx.code,
        value: idx.value,
        change: idx.change,
        changePercent: idx.changePercent,
        volume: idx.volume,
        updatedAt: new Date(idx.eventTime).toISOString(),
      });
    }
    if (live.length >= 2) {
      return {
        items: sortIndices(live),
        meta: buildMeta({
          source: "ssi-ws",
          sourceTimestampMs: Math.max(...live.map((x) => Date.parse(x.updatedAt ?? "") || 0)),
          note: "Chỉ số LIVE — SSI DataHub",
        }),
      };
    }
  }
  if (ssiFcConfigured()) {
    try {
      const res = await cached("vn:indices:ssi:v1", {
        ttlMs: 20_000,
        producer: async () => {
          const r = await getSsiIndices(INDEX_PRIORITY);
          if (!r.items.length) throw new Error("ssi empty indices");
          return r;
        },
      });
      return {
        items: sortIndices(res.value.items),
        meta: buildMeta({
          source: "ssi-fcdata",
          sourceTimestampMs: res.value.sourceTs,
          cached: res.cached,
          note: "SSI DailyIndex",
        }),
      };
    } catch {
      /* fallback */
    }
  }
  try {
    const res = await cached("vn:indices:vnd:v1", {
      ttlMs: 30_000,
      producer: () => vndirect.getVndIndices(),
    });
    return {
      items: sortIndices(res.value.items),
      meta: buildMeta({
        source: "vndirect",
        sourceTimestampMs: res.value.sourceTs,
        cached: res.cached,
      }),
    };
  } catch {
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
  if (ssiFcConfigured()) {
    try {
      const res = await cached("vn:market-board:ssi:v2", {
        ttlMs: 15_000,
        producer: async () => {
          const [board, indices] = await Promise.all([
            getSsiFullBoard(),
            getSsiIndices(INDEX_PRIORITY).catch(() => ({
              items: [] as IndexQuote[],
              sourceTs: null as number | null,
            })),
          ]);
          return { board, indices };
        },
      });
      const { board, indices } = res.value;
      const quotes = board.quotes.map((q) => liveQuoteFromWs(q.symbol) ?? q);
      return {
        quotes,
        indices: sortIndices(indices.items),
        universeSize: quotes.length,
        sessionDate: board.sessionDate,
        meta: buildMeta({
          source: "ssi-fcdata",
          sourceTimestampMs: board.sourceTs,
          cached: res.cached,
          note: "SSI board",
        }),
      };
    } catch {
      /* fallback */
    }
  }
  try {
    const [mq, idx] = await Promise.all([
      vndirect.getVndMarketQuotes(),
      vndirect.getVndIndices().catch(() => ({
        items: [] as IndexQuote[],
        sourceTs: null as number | null,
      })),
    ]);
    return {
      quotes: mq.quotes,
      indices: sortIndices(idx.items),
      universeSize: mq.quotes.length,
      sessionDate: mq.sessionDate,
      meta: buildMeta({ source: "vndirect", sourceTimestampMs: mq.sourceTs }),
    };
  } catch {
    return null;
  }
}

export async function getVnUniverseList(): Promise<{
  items: { symbol: string; name: string | null; exchange: string | null; industry: string | null }[];
  meta: Meta;
} | null> {
  if (ssiFcConfigured()) {
    try {
      const res = await cached("vn:universe:ssi:v1", {
        ttlMs: 6 * 3_600_000,
        producer: () => getSsiUniverse(),
      });
      return {
        items: res.value,
        meta: buildMeta({ source: "ssi-fcdata", sourceTimestampMs: Date.now(), cached: res.cached }),
      };
    } catch {
      /* fallthrough */
    }
  }
  try {
    const res = await cached("vn:universe:vnd:v1", {
      ttlMs: 6 * 3_600_000,
      producer: () => vndirect.getVndUniverse(),
    });
    const items = res.value.map((s) => ({
      symbol: typeof s === "string" ? s : String((s as { symbol?: string }).symbol ?? ""),
      name: null as string | null,
      exchange: null as string | null,
      industry: null as string | null,
    }));
    return {
      items,
      meta: buildMeta({ source: "vndirect", sourceTimestampMs: Date.now(), cached: res.cached }),
    };
  } catch {
    return null;
  }
}

export async function getVnQuotes(symbols: string[]): Promise<{ quotes: Quote[]; meta: Meta } | null> {
  if (!symbols.length) return null;
  bootSsiLive();
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))].slice(0, 40);
  if (ssiFcConfigured() && process.env.SSI_WS_DISABLED !== "true") {
    for (const s of uniq) ssiWs.watchSymbol(s);
  }
  const out: Quote[] = [];
  const missing: string[] = [];
  for (const s of uniq) {
    const live = liveQuoteFromWs(s);
    if (live) out.push(live);
    else missing.push(s);
  }
  if (missing.length && ssiFcConfigured()) {
    try {
      const r = await getSsiQuotes(missing);
      out.push(...r.quotes);
    } catch {
      /* fallthrough */
    }
  }
  const have = new Set(out.map((q) => q.symbol));
  const still = missing.filter((s) => !have.has(s));
  if (still.length) {
    try {
      const v = await vndirect.getVndQuotes(still);
      out.push(...v.quotes);
    } catch {
      /* ignore */
    }
  }
  return {
    quotes: out,
    meta: buildMeta({
      source: ssiFcConfigured() ? "ssi-fcdata" : "vndirect",
      sourceTimestampMs: Date.now(),
    }),
  };
}

export async function getVnOhlcv(
  symbol: string,
  limit = 250,
): Promise<{ bars: OhlcvBar[]; meta: Meta } | null> {
  const sym = symbol.toUpperCase();
  bootSsiLive();
  const isIndex = vndirect.isVnIndexSymbol(sym);
  if (ssiFcConfigured() && !isIndex) ssiWs.watchSymbol(sym);

  if (ssiFcConfigured()) {
    try {
      const res = await cached(`vn:ohlcv:ssi:${sym}:${limit}`, {
        ttlMs: 60_000,
        producer: async () => {
          const bars = await getSsiDailyOhlc(sym);
          if (!bars.length) throw new Error("ssi empty ohlc");
          return bars;
        },
      });
      const bars = res.value.slice(-limit);
      const q = validateBars(bars);
      if (q.status !== "VALID") void logQualityEvent("ssi-fcdata", `ohlcv:${sym}`, q);
      return {
        bars,
        meta: buildMeta({
          source: "ssi-fcdata",
          sourceTimestampMs: Date.now(),
          cached: res.cached,
          note: "SSI OHLCV",
        }),
      };
    } catch {
      /* fallback */
    }
  }
  try {
    const bars = isIndex
      ? await vndirect.getVndIndexOhlcv(sym, limit)
      : await vndirect.getVndOhlcv(sym, limit);
    return {
      bars,
      meta: buildMeta({ source: "vndirect", sourceTimestampMs: Date.now() }),
    };
  } catch {
    return null;
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
  bootSsiLive();
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
