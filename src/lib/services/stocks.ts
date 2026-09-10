import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { getFinancialsForSymbol } from "../financial/service";
import type { FinancialPackageMeta, GrowthSnapshot, NormalizedPeriod } from "../financial/types";
import type { FinancialHealthResult } from "../engines/fundamental";
import * as vndirect from "../providers/vndirect";
import {
  getSsiDailyOhlc,
  getSsiQuotes,
  ssiFcConfigured,
} from "../providers/ssi-fcdata";
import { validateBars, logQualityEvent } from "../quality";
import { analyzeSeries, detectPatterns } from "../technical";
import type { CandlePattern, IndexQuote, Meta, OhlcvBar, Quote, TechnicalSnapshot } from "../types";

/**
 * Vietnam equity domain service.
 *
 * Provider strategy:
 *   PRIMARY  = SSI FastConnect Data (when SSI_FC_CONSUMER_ID + SECRET set)
 *   FALLBACK = VNDirect (api-finfo) — board, quotes, OHLCV, indices
 *   FINANCIAL = Financial Report Engine (Source Router → SSI stub / VNDirect)
 *
 * Never fabricates Vietnam market numbers.
 */

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

/** @deprecated Use vnMarketConfigured */
export function vnstockConfigured(): boolean {
  return vnMarketConfigured();
}

export function vnPrimaryProvider(): "ssi-fcdata" | "vndirect" {
  return ssiFcConfigured() ? "ssi-fcdata" : "vndirect";
}

export async function getVnIndices(): Promise<{ items: IndexQuote[]; meta: Meta } | null> {
  // Indices still via VNDirect until SSI IndexList + DailyIndex mapping is validated with live keys
  try {
    const res = await cached("vn:indices:vnd:v1", {
      ttlMs: 45_000,
      staleMs: 24 * 3_600_000,
      producer: () => vndirect.getVndIndices(),
    });
    const meta = buildMeta({
      source: "vndirect",
      sourceTimestampMs: res.value.sourceTs,
      cached: res.cached,
      stale: res.stale,
      note: ssiFcConfigured()
        ? "Chỉ số VN — VNDirect (SSI index mapping sẽ bật sau khi validate key)"
        : "Chỉ số VN (VNINDEX/VN30/HNX/UPCOM) — VNDirect",
      slas: { liveSlaMs: 30_000, freshSlaMs: 300_000, delayedSlaMs: 3_600_000 },
    });
    return { items: sortIndices(res.value.items), meta };
  } catch {
    return null;
  }
}

export async function getVnMarketBoard(): Promise<{
  quotes: Quote[];
  indices: IndexQuote[];
  universe: { symbol: string; name: string | null; exchange: string | null; industry: string | null }[];
  sessionDate: string;
  meta: Meta;
} | null> {
  // Full board still VNDirect (paginated). SSI DailyStockPrice is per-symbol — not ideal for full board yet.
  try {
    const res = await cached("vn:market-board:vnd:v1", {
      ttlMs: 60_000,
      staleMs: 24 * 3_600_000,
      producer: async () => {
        const [board, indices, universe] = await Promise.all([
          vndirect.getVndMarketQuotes(),
          vndirect.getVndIndices().catch(() => ({ items: [] as IndexQuote[], sourceTs: null as number | null })),
          vndirect.getVndUniverse().catch(
            () => [] as { symbol: string; name: string | null; exchange: string | null; industry: string | null }[],
          ),
        ]);
        const bySym = new Map(universe.map((u) => [u.symbol, u]));
        const quotes = board.quotes.map((q) => {
          const u = bySym.get(q.symbol);
          return u ? { ...q, name: q.name ?? u.name } : q;
        });
        return {
          quotes,
          indices: sortIndices(indices.items),
          universe,
          sessionDate: board.sessionDate,
          sourceTs: board.sourceTs ?? indices.sourceTs,
        };
      },
    });
    const meta = buildMeta({
      source: ssiFcConfigured() ? "vndirect|ssi-ready" : "vndirect",
      sourceTimestampMs: res.value.sourceTs,
      cached: res.cached,
      stale: res.stale,
      note: ssiFcConfigured()
        ? `Phiên ${res.value.sessionDate} · board VNDirect · SSI FC Data đã cấu hình (quote/OHLCV ưu tiên SSI)`
        : `Phiên ${res.value.sessionDate} · ${res.value.quotes.length} mã · nguồn VNDirect (tạm thời)`,
      slas: { liveSlaMs: 60_000, freshSlaMs: 600_000, delayedSlaMs: 6 * 3_600_000 },
    });
    return {
      quotes: res.value.quotes,
      indices: res.value.indices,
      universe: res.value.universe,
      sessionDate: res.value.sessionDate,
      meta,
    };
  } catch {
    return null;
  }
}

export async function getVnUniverseList(): Promise<
  | { items: { symbol: string; name: string | null; exchange: string | null; industry: string | null }[]; meta: Meta }
  | null
> {
  try {
    const res = await cached("vn:universe:vnd:v1", {
      ttlMs: 6 * 3_600_000,
      staleMs: 7 * 24 * 3_600_000,
      producer: () => vndirect.getVndUniverse(),
    });
    return {
      items: res.value,
      meta: buildMeta({
        source: "vndirect",
        sourceTimestampMs: Date.now(),
        cached: res.cached,
        stale: res.stale,
        note: "Universe HOSE/HNX/UPCoM — VNDirect",
      }),
    };
  } catch {
    return null;
  }
}

export async function getVnQuotes(symbols: string[]): Promise<{ quotes: Quote[]; meta: Meta } | null> {
  if (!symbols.length) return null;

  // PRIMARY: SSI when keys present
  if (ssiFcConfigured()) {
    try {
      const key = `vn:quotes:ssi:${symbols
        .slice(0, 20)
        .map((s) => s.toUpperCase())
        .sort()
        .join(",")}`;
      const res = await cached(key, {
        ttlMs: 15_000,
        staleMs: 24 * 3_600_000,
        producer: async () => {
          const v = await getSsiQuotes(symbols);
          if (!v.quotes.length) throw new Error("ssi empty quotes");
          return { quotes: v.quotes, sourceTs: v.sourceTs, source: "ssi-fcdata" as const };
        },
      });
      return {
        quotes: res.value.quotes,
        meta: buildMeta({
          source: "ssi-fcdata",
          sourceTimestampMs: res.value.sourceTs,
          cached: res.cached,
          stale: res.stale,
          note: "Quotes — SSI FastConnect Data",
        }),
      };
    } catch {
      // fall through to VNDirect
    }
  }

  try {
    const key = `vn:quotes:vnd:${symbols
      .slice(0, 30)
      .map((s) => s.toUpperCase())
      .sort()
      .join(",")}`;
    const res = await cached(key, {
      ttlMs: 15_000,
      staleMs: 24 * 3_600_000,
      producer: async () => {
        const v = await vndirect.getVndQuotes(symbols);
        if (!v.quotes.length) throw new Error("vndirect empty quotes");
        return { quotes: v.quotes, sourceTs: v.sourceTs };
      },
    });
    return {
      quotes: res.value.quotes,
      meta: buildMeta({
        source: "vndirect",
        sourceTimestampMs: res.value.sourceTs,
        cached: res.cached,
        stale: res.stale,
        note: ssiFcConfigured() ? "Quotes fallback VNDirect" : undefined,
      }),
    };
  } catch {
    return null;
  }
}

export async function getVnOhlcv(symbol: string, limit = 250): Promise<{ bars: OhlcvBar[]; meta: Meta } | null> {
  const sym = symbol.toUpperCase();

  if (ssiFcConfigured() && !vndirect.isVnIndexSymbol(sym)) {
    try {
      const res = await cached(`vn:ohlcv:ssi:${sym}:${limit}`, {
        ttlMs: 60_000,
        staleMs: 7 * 24 * 3_600_000,
        producer: async () => {
          const bars = await getSsiDailyOhlc(sym);
          const q = validateBars(bars.slice(-limit));
          if (q.status !== "VALID") void logQualityEvent("ssi-fcdata", `ohlcv:${sym}`, q);
          if (q.status === "INVALID") throw new Error("invalid ohlcv series");
          return {
            bars: q.cleaned,
            fetchedAt: Date.now(),
            source: "ssi-fcdata" as const,
            note: "OHLCV cổ phiếu — SSI FastConnect Data",
            qualityStatus: q.status,
          };
        },
      });
      const last = res.value.bars[res.value.bars.length - 1];
      const meta = buildMeta({
        source: res.value.source,
        sourceTimestampMs: last?.time ?? res.value.fetchedAt,
        cached: res.cached,
        stale: res.stale,
        note: res.value.note,
        slas: { liveSlaMs: 3_600_000, freshSlaMs: 8 * 3_600_000, delayedSlaMs: 48 * 3_600_000 },
      });
      meta.qualityStatus = res.value.qualityStatus;
      return { bars: res.value.bars, meta };
    } catch {
      // fall through
    }
  }

  try {
    const res = await cached(`vn:ohlcv:vnd:${sym}:${limit}`, {
      ttlMs: 60_000,
      staleMs: 7 * 24 * 3_600_000,
      producer: async () => {
        const bars = vndirect.isVnIndexSymbol(sym)
          ? await vndirect.getVndIndexOhlcv(sym, limit)
          : await vndirect.getVndOhlcv(sym, limit);
        const q = validateBars(bars);
        if (q.status !== "VALID") void logQualityEvent("vndirect", `ohlcv:${sym}`, q);
        if (q.status === "INVALID") throw new Error("invalid ohlcv series");
        return {
          bars: q.cleaned,
          fetchedAt: Date.now(),
          source: "vndirect" as const,
          note: vndirect.isVnIndexSymbol(sym) ? "OHLCV chỉ số VNDirect" : "OHLCV cổ phiếu VNDirect",
          qualityStatus: q.status,
        };
      },
    });
    const last = res.value.bars[res.value.bars.length - 1];
    const meta = buildMeta({
      source: res.value.source,
      sourceTimestampMs: last?.time ?? res.value.fetchedAt,
      cached: res.cached,
      stale: res.stale,
      note: res.value.note,
      slas: { liveSlaMs: 3_600_000, freshSlaMs: 8 * 3_600_000, delayedSlaMs: 48 * 3_600_000 },
    });
    meta.qualityStatus = res.value.qualityStatus;
    return { bars: res.value.bars, meta };
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
    notes.push("Nguồn thị trường: SSI FastConnect Data (PRIMARY) · VNDirect fallback.");
  } else {
    notes.push("Nguồn thị trường tạm thời: VNDirect — gắn SSI_FC_CONSUMER_ID + SSI_FC_CONSUMER_SECRET để bật SSI.");
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
    source: [quoteSource, ohlcvSource, fin?.packageMeta?.primarySource]
      .filter(Boolean)
      .join("+") || (ssiFcConfigured() ? "ssi-fcdata|vndirect" : "vndirect"),
    sourceTimestampMs: quote?.updatedAt
      ? Date.parse(quote.updatedAt.includes("/") ? quote.updatedAt.split("/").reverse().join("-") : quote.updatedAt)
      : bars.length
        ? bars[bars.length - 1].time
        : Date.now(),
    degraded: failed.length > 0,
    partial: failed.length > 0,
    note: notes[0],
  });
  return { detail, meta };
}
