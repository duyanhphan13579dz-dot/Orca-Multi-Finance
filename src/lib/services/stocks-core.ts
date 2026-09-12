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

/**
 * Vietnam equity domain — SSI FastConnect PRIMARY when keys set.
 * VNDirect = fallback only.
 * Restored from stable commit; SSI market boot pipeline wired.
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
    for (const code of ["VNINDEX", "VN30", "HNX", "HNX30", "UPCOM"]) {
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
          slas: { liveSlaMs: 15_000, freshSlaMs: 60_000, delayedSlaMs: 300_000 },
        }),
      };
    }
  }

  if (ssiFcConfigured()) {
    try {
      const res = await cached("vn:indices:ssi:v1", {
        ttlMs: 20_000,
        staleMs: 120_000,
        producer: async () => {
          const r = await getSsiIndices();
          if (!r.items.length) throw new Error("ssi empty indices");
          return r;
        },
      });
      return {
        items: sortIndices(res.value.items),
        meta: buildMeta({
          source: "ssi-fcdata",
          sourceTimestampMs: Date.now(),
          cached: res.cached,
          note: "Chỉ số VN — SSI FastConnect DailyIndex",
          slas: { liveSlaMs: 30_000, freshSlaMs: 300_000, delayedSlaMs: 3_600_000 },
        }),
      };
    } catch {
      /* fallback */
    }
  }

  try {
    const res = await cached("vn:indices:vnd:v1", {
      ttlMs: 30_000,
      staleMs: 180_000,
      producer: () => vndirect.getVndIndices(),
    });
    return {
      items: sortIndices(res.value.items),
      meta: buildMeta({
        source: "vndirect",
        sourceTimestampMs: Date.now(),
        cached: res.cached,
        note: ssiFcConfigured() ? "Chỉ số fallback VNDirect" : "Chỉ số VN — VNDirect",
        slas: { liveSlaMs: 30_000, freshSlaMs: 300_000, delayedSlaMs: 3_600_000 },
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
        staleMs: 90_000,
        producer: async () => getSsiFullBoard(),
      });
      const board = res.value as {
        quotes: Quote[];
        indices?: IndexQuote[];
        universeSize?: number;
        sessionDate?: string;
        sourceTs?: number | null;
      };
      const quotes = board.quotes.map((q) => liveQuoteFromWs(q.symbol) ?? q);
      let indices = board.indices ?? [];
      if (process.env.SSI_WS_DISABLED !== "true") {
        const liveIdx: IndexQuote[] = [];
        for (const code of ["VNINDEX", "VN30", "HNX", "HNX30", "UPCOM"]) {
          const idx = ssiWs.getIndex(code, 30_000);
          if (idx) {
            liveIdx.push({
              code: idx.code,
              name: idx.code,
              value: idx.value,
              change: idx.change,
              changePercent: idx.changePercent,
              volume: idx.volume,
              updatedAt: new Date(idx.eventTime).toISOString(),
            });
          }
        }
        if (liveIdx.length >= 2) indices = sortIndices(liveIdx);
      }
      return {
        quotes,
        indices: sortIndices(indices),
        universeSize: board.universeSize ?? quotes.length,
        sessionDate: board.sessionDate ?? new Date().toISOString().slice(0, 10),
        meta: buildMeta({
          source: "ssi-fcdata",
          sourceTimestampMs: board.sourceTs ?? Date.now(),
          cached: res.cached,
          note: "Bảng giá — SSI FastConnect (WS overlay khi có)",
          slas: { liveSlaMs: 15_000, freshSlaMs: 60_000, delayedSlaMs: 300_000 },
        }),
      };
    } catch {
      /* fallback */
    }
  }

  try {
    const [quotesRes, indicesRes] = await Promise.all([
      vndirect.getVndMarketQuotes(),
      vndirect.getVndIndices().catch(() => ({ items: [] as IndexQuote[], sourceTs: null as number | null })),
    ]);
    return {
      quotes: quotesRes.quotes,
      indices: sortIndices(indicesRes.items),
      universeSize: quotesRes.quotes.length,
      sessionDate: new Date().toISOString().slice(0, 10),
      meta: buildMeta({
        source: "vndirect",
        sourceTimestampMs: quotesRes.sourceTs ?? Date.now(),
        note: ssiFcConfigured() ? "Board fallback VNDirect" : "Board VNDirect",
        slas: { liveSlaMs: 30_000, freshSlaMs: 120_000, delayedSlaMs: 600_000 },
      }),
    };
  } catch {
    return null;
  }
}

export async function getVnUniverseList(): Promise<{ symbols: string[]; meta: Meta } | null> {
  bootSsiLive();
  if (ssiFcConfigured()) {
    try {
      const res = await cached("vn:universe:ssi:v1", {
        ttlMs: 3600_000,
        staleMs: 7200_000,
        producer: async () => {
          const u = await getSsiUniverse();
          if (!u.length) throw new Error("ssi empty universe");
          return u;
        },
      });
      const symbols = res.value
        .map((x) => (typeof x === "string" ? x : String((x as { symbol?: string }).symbol ?? "")))
        .filter(Boolean);
      return {
        symbols,
        meta: buildMeta({ source: "ssi-fcdata", sourceTimestampMs: Date.now(), cached: res.cached, note: "Universe — SSI" }),
      };
    } catch {
      /* fallback */
    }
  }
  try {
    const res = await cached("vn:universe:vnd:v1", {
      ttlMs: 3600_000,
      producer: () => vndirect.getVndUniverse(),
    });
    return {
      symbols: res.value,
      meta: buildMeta({ source: "vndirect", sourceTimestampMs: Date.now(), cached: res.cached, note: "Universe — VNDirect" }),
    };
  } catch {
    return null;
  }
}

export async function getVnQuotes(symbols: string[]): Promise<{ quotes: Quote[]; meta: Meta } | null> {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))].slice(0, 80);
  if (!uniq.length) return { quotes: [], meta: buildMeta({ source: "none", sourceTimestampMs: Date.now() }) };
  bootSsiLive();

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
      /* fallback */
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
      note: `Quotes ${out.length}/${uniq.length}`,
    }),
  };
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
        ttlMs: 120_000,
        staleMs: 600_000,
        producer: async () => {
          const r = await getSsiDailyOhlc(sym, Math.max(limit, 30));
          if (!r.bars.length) throw new Error("ssi empty ohlc");
          return r;
        },
      });
      const bars = res.value.bars.slice(-limit);
      const v = validateBars(bars);
      if (!v.ok) logQualityEvent("ohlcv", sym, v.reason);
      return {
        bars,
        meta: buildMeta({
          source: "ssi-fcdata",
          sourceTimestampMs: res.value.sourceTs ?? Date.now(),
          cached: res.cached,
          note: "OHLCV — SSI FastConnect",
          slas: { liveSlaMs: 60_000, freshSlaMs: 300_000, delayedSlaMs: 3_600_000 },
        }),
      };
    } catch {
      /* fallback */
    }
  }

  try {
    const isIndex = vndirect.isVnIndexSymbol(sym);
    const bars = isIndex
      ? await vndirect.getVndIndexOhlcv(sym, limit)
      : await vndirect.getVndOhlcv(sym, limit);
    return {
      bars,
      meta: buildMeta({
        source: "vndirect",
        sourceTimestampMs: Date.now(),
        note: ssiFcConfigured() ? "OHLCV fallback VNDirect" : "OHLCV VNDirect",
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
  if (!fin?.financials.income && !fin?.financials.balance) failed.push("financials");

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
