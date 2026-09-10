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
import { validateBars, logQualityEvent } from "../quality";
import { analyzeSeries, detectPatterns } from "../technical";
import type { CandlePattern, IndexQuote, Meta, OhlcvBar, Quote, TechnicalSnapshot } from "../types";

/**
 * Vietnam equity domain — SSI FastConnect PRIMARY when keys set.
 * VNDirect = fallback only.
 */

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
    ensureSsiWsStarted();
  } catch {
    /* non-fatal */
  }
}

export function vnMarketConfigured(): boolean {
  return true;
}

/** @deprecated Use vnMarketConfigured */
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
        value: idx.value,
        change: idx.change,
        changePercent: idx.changePercent,
        volume: idx.volume,
        valueTraded: idx.valueTraded,
        advances: idx.advances,
        declines: idx.declines,
        unchanged: idx.unchanged,
      });
    }
    if (live.length) {
      return {
        items: sortIndices(live),
        meta: buildMeta({
          source: "ssi-ws",
          sourceTimestampMs: Date.now(),
          note: "SSI DataHub live indices",
          slas: { liveSlaMs: 15_000, freshSlaMs: 60_000, delayedSlaMs: 300_000 },
        }),
      };
    }
  }

  if (ssiFcConfigured()) {
    try {
      const res = await cached("vn:indices:ssi:v1", {
        ttlMs: 30_000,
        staleMs: 600_000,
        producer: async () => {
          const r = await getSsiIndices(INDEX_PRIORITY);
          return r;
        },
      });
      return {
        items: sortIndices(res.value.items),
        meta: buildMeta({
          source: "ssi-fcdata",
          sourceTimestampMs: res.value.sourceTs,
          cached: res.cached,
          stale: res.stale,
          note: "SSI FastConnect indices",
          slas: { liveSlaMs: 30_000, freshSlaMs: 120_000, delayedSlaMs: 600_000 },
        }),
      };
    } catch {
      /* fall through */
    }
  }

  try {
    const res = await cached("vn:indices:vnd:v1", {
      ttlMs: 60_000,
      staleMs: 600_000,
      producer: async () => vndirect.getVndIndices(),
    });
    return {
      items: sortIndices(res.value.items),
      meta: buildMeta({
        source: "vndirect",
        sourceTimestampMs: res.value.sourceTs,
        cached: res.cached,
        stale: res.stale,
        note: "VNDirect indices fallback",
        slas: { liveSlaMs: 60_000, freshSlaMs: 300_000, delayedSlaMs: 1_800_000 },
      }),
    };
  } catch {
    return null;
  }
}

export async function getVnQuotes(
  symbols: string[],
): Promise<{ quotes: Quote[]; meta: Meta } | null> {
  bootSsiLive();
  const syms = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
  if (!syms.length) return { quotes: [], meta: buildMeta({ source: "internal", sourceTimestampMs: Date.now() }) };

  if (ssiFcConfigured()) {
    try {
      const liveMap = new Map<string, Quote>();
      if (process.env.SSI_WS_DISABLED !== "true") {
        for (const s of syms) {
          const lq = liveQuoteFromWs(s);
          if (lq) liveMap.set(s, lq);
        }
      }

      const missing = syms.filter((s) => !liveMap.has(s));
      let rest: Quote[] = [];
      if (missing.length) {
        const res = await cached(`vn:quotes:ssi:${missing.sort().join(",")}`, {
          ttlMs: 20_000,
          staleMs: 300_000,
          producer: async () => getSsiQuotes(missing),
        });
        rest = res.value.quotes;
      }

      const bySym = new Map<string, Quote>();
      for (const q of rest) bySym.set(q.symbol, q);
      for (const [s, q] of liveMap) bySym.set(s, q);

      const quotes = syms.map((s) => bySym.get(s)).filter((q): q is Quote => q != null);
      if (quotes.length) {
        return {
          quotes,
          meta: buildMeta({
            source: liveMap.size ? "ssi-ws+ssi-fcdata" : "ssi-fcdata",
            sourceTimestampMs: Date.now(),
            note: `${liveMap.size} live / ${quotes.length} total`,
            slas: { liveSlaMs: 15_000, freshSlaMs: 60_000, delayedSlaMs: 300_000 },
          }),
        };
      }
    } catch {
      /* fall through */
    }
  }

  try {
    const res = await cached(`vn:quotes:vnd:${syms.sort().join(",")}`, {
      ttlMs: 30_000,
      staleMs: 300_000,
      producer: async () => vndirect.getVndQuotes(syms),
    });
    return {
      quotes: res.value.quotes,
      meta: buildMeta({
        source: "vndirect",
        sourceTimestampMs: res.value.sourceTs,
        cached: res.cached,
        stale: res.stale,
        note: "VNDirect quotes fallback",
        slas: { liveSlaMs: 30_000, freshSlaMs: 120_000, delayedSlaMs: 600_000 },
      }),
    };
  } catch {
    return null;
  }
}

export async function getVnOhlcv(
  symbol: string,
  limit = 250,
): Promise<{ bars: OhlcvBar[]; meta: Meta } | null> {
  const sym = symbol.toUpperCase();
  bootSsiLive();

  if (ssiFcConfigured()) {
    try {
      const res = await cached(`vn:ohlcv:ssi:${sym}:${limit}`, {
        ttlMs: 60_000,
        staleMs: 24 * 3_600_000,
        producer: async () => {
          const bars = await getSsiDailyOhlc(sym, { pageSize: Math.min(1000, Math.max(limit, 100)) });
          const sliced = bars.slice(-limit);
          const q = validateBars(sliced);
          if (q.qualityStatus === "INVALID") {
            logQualityEvent({ domain: "stock-ohlcv", symbol: sym, status: q.qualityStatus, note: q.note });
          }
          return { bars: sliced, qualityStatus: q.qualityStatus };
        },
      });
      return {
        bars: res.value.bars,
        meta: buildMeta({
          source: "ssi-fcdata",
          sourceTimestampMs: res.value.bars.length ? res.value.bars[res.value.bars.length - 1].time : null,
          cached: res.cached,
          stale: res.stale,
          note: `SSI DailyOhlc · ${res.value.bars.length} bars`,
          slas: { liveSlaMs: 3_600_000, freshSlaMs: 8 * 3_600_000, delayedSlaMs: 48 * 3_600_000 },
        }),
      };
    } catch {
      /* fall through */
    }
  }

  try {
    const res = await cached(`vn:ohlcv:vnd:${sym}:${limit}`, {
      ttlMs: 120_000,
      staleMs: 24 * 3_600_000,
      producer: async () => {
        const bars = await vndirect.getVndOhlcv(sym, limit);
        const q = validateBars(bars);
        return { bars, qualityStatus: q.qualityStatus };
      },
    });
    return {
      bars: res.value.bars,
      meta: buildMeta({
        source: "vndirect",
        sourceTimestampMs: res.value.bars.length ? res.value.bars[res.value.bars.length - 1].time : null,
        cached: res.cached,
        stale: res.stale,
        note: `VNDirect OHLCV · ${res.value.bars.length} bars`,
        slas: { liveSlaMs: 3_600_000, freshSlaMs: 8 * 3_600_000, delayedSlaMs: 48 * 3_600_000 },
      }),
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

export async function getVnStockDetail(symbol: string): Promise<{ detail: VnStockDetail; meta: Meta } | null> {
  const sym = symbol.toUpperCase();
  bootSsiLive();
  if (ssiFcConfigured() && process.env.SSI_WS_DISABLED !== "true") ssiWs.watchSymbol(sym);

  const [quotesRes, ohlcvRes, finRes] = await Promise.allSettled([
    getVnQuotes([sym]),
    getVnOhlcv(sym, 250),
    getFinancialsForSymbol(sym),
  ]);
  const quote = quotesRes.status === "fulfilled" ? quotesRes.value?.quotes[0] ?? null : null;
  const bars = ohlcvRes.status === "fulfilled" ? ohlcvRes.value?.bars ?? [] : [];
  const fin = finRes.status === "fulfilled" ? finRes.value : null;
  const failed: string[] = [];
  if (!quote) failed.push("quote");
  if (!bars.length) failed.push("ohlcv");
  if (!fin?.financials.income && !fin?.financials.balance) failed.push("financials");
  if (!quote && !bars.length && !fin) return null;

  const notes: string[] = [];
  if (failed.length) notes.push(`Một số bộ dữ liệu chưa khả dụng: ${failed.join(", ")}`);
  if (fin?.notes?.length) notes.push(...fin.notes);
  if (ssiFcConfigured()) {
    notes.push("Nguồn thị trường PRIMARY: SSI FastConnect · VNDirect chỉ khi SSI lỗi.");
  } else {
    notes.push("Nguồn tạm: VNDirect — set SSI_FC_CONSUMER_ID + SSI_FC_CONSUMER_SECRET.");
  }

  const detail: VnStockDetail = {
    symbol: sym,
    quote,
    bars,
    technical: bars.length ? analyzeSeries(bars) : null,
    patterns: bars.length ? detectPatterns(bars) : [],
    financials: fin?.financials ?? { income: null, balance: null, cashflow: null, ratios: null },
    financialHealth: fin?.health ?? null,
    financialMeta: fin?.packageMeta ?? null,
    financialGrowth: fin?.growth ?? null,
    financialTtm: fin?.ttm ?? null,
    notes,
  };

  const quoteSource =
    quotesRes.status === "fulfilled" && quotesRes.value?.meta?.source
      ? String(quotesRes.value.meta.source)
      : null;
  const ohlcvSource =
    ohlcvRes.status === "fulfilled" && ohlcvRes.value?.meta?.source
      ? String(ohlcvRes.value.meta.source)
      : null;

  const meta = buildMeta({
    source:
      [quoteSource, ohlcvSource, fin?.packageMeta?.primarySource].filter(Boolean).join("+") ||
      (ssiFcConfigured() ? "ssi-fcdata" : "vndirect"),
    sourceTimestampMs: quote?.updatedAt
      ? Date.parse(
          quote.updatedAt.includes("/") ? quote.updatedAt.split("/").reverse().join("-") : quote.updatedAt,
        )
      : bars.length
        ? bars[bars.length - 1].time
        : Date.now(),
    degraded: failed.length > 0,
    partial: failed.length > 0,
    note: notes[0],
  });
  return { detail, meta };
}

/** Re-export order book helpers (canonical module: stock-orderbook.ts). */
export { getVnOrderBook, type VnOrderBook } from "./stock-orderbook";
