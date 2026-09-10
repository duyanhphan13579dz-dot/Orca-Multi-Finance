import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { getFinancialsForSymbol } from "../financial/service";
import type { FinancialPackageMeta, GrowthSnapshot, NormalizedPeriod } from "../financial/types";
import type { FinancialHealthResult } from "../engines/fundamental";
import * as vndirect from "../providers/vndirect";
import { getSsiDailyOhlc, getSsiQuotes, ssiFcConfigured } from "../providers/ssi-fcdata";
import { ensureSsiWsStarted, ssiWs } from "../realtime/ssi-ws";
import { validateBars, logQualityEvent } from "../quality";
import { analyzeSeries, detectPatterns } from "../technical";
import type { CandlePattern, IndexQuote, Meta, OhlcvBar, Quote, TechnicalSnapshot } from "../types";

/**
 * Vietnam equity domain service.
 *
 * LIVE priority (when SSI_FC_CONSUMER_ID + SECRET set):
 *   1) SSI WebSocket tick cache (if not SSI_WS_DISABLED)
 *   2) SSI REST (DailyStockPrice / DailyOhlc)
 *   3) VNDirect fallback
 *
 * Zero-config: only env keys required — no code change.
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

  // Overlay LIVE ticks from SSI WS when present
  if (ssiFcConfigured() && process.env.SSI_WS_DISABLED !== "true") {
    const live: IndexQuote[] = [];
    for (const code of INDEX_PRIORITY) {
      const idx = ssiWs.getIndex(code, 30_000);
      if (!idx) continue;
      live.push({
        code: idx.code,
        name: idx.code,
        value: idx.value,
        change: idx.change ?? 0,
        changePercent: idx.changePercent ?? 0,
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
          note: "Chỉ số LIVE — SSI FastConnect WebSocket",
          slas: { liveSlaMs: 15_000, freshSlaMs: 60_000, delayedSlaMs: 300_000 },
        }),
      };
    }
  }

  try {
    const res = await cached("vn:indices:vnd:v1", {
      ttlMs: 45_000,
      staleMs: 24 * 3_600_000,
      producer: () => vndirect.getVndIndices(),
    });
    const meta = buildMeta({
      source: ssiFcConfigured() ? "vndirect|ssi-pending-ws" : "vndirect",
      sourceTimestampMs: res.value.sourceTs,
      cached: res.cached,
      stale: res.stale,
      note: ssiFcConfigured()
        ? "Chỉ số VN — VNDirect (SSI WS chưa có tick hoặc đang reconnect)"
        : "Chỉ số VN — VNDirect",
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
  bootSsiLive();

  // Full board still VNDirect (paginated). LIVE SSI overlays individual symbols via getVnQuotes.
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
        let quotes = board.quotes.map((q) => {
          const u = bySym.get(q.symbol);
          return u ? { ...q, name: q.name ?? u.name } : q;
        });

        // Patch board rows with fresh SSI WS ticks when available
        if (ssiFcConfigured() && process.env.SSI_WS_DISABLED !== "true") {
          quotes = quotes.map((q) => {
            const live = liveQuoteFromWs(q.symbol);
            return live ? { ...q, ...live, name: q.name } : q;
          });
        }

        return {
          quotes,
          indices: sortIndices(indices.items),
          universe,
          sessionDate: board.sessionDate,
          sourceTs: board.sourceTs ?? indices.sourceTs,
        };
      },
    });

    const ssiOn = ssiFcConfigured();
    const meta = buildMeta({
      source: ssiOn ? "vndirect+ssi-ws-overlay" : "vndirect",
      sourceTimestampMs: res.value.sourceTs,
      cached: res.cached,
      stale: res.stale,
      note: ssiOn
        ? `Phiên ${res.value.sessionDate} · board VNDirect · overlay SSI LIVE khi có tick`
        : `Phiên ${res.value.sessionDate} · ${res.value.quotes.length} mã · VNDirect`,
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
  bootSsiLive();

  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))].slice(0, 40);

  // 1) LIVE WebSocket ticks
  if (ssiFcConfigured() && process.env.SSI_WS_DISABLED !== "true") {
    for (const s of uniq) ssiWs.watchSymbol(s);
    const liveQuotes: Quote[] = [];
    let newest = 0;
    for (const s of uniq) {
      const q = liveQuoteFromWs(s);
      if (q) {
        liveQuotes.push(q);
        const t = q.updatedAt ? Date.parse(q.updatedAt) : 0;
        if (t > newest) newest = t;
      }
    }
    // If we have all requested symbols from WS — return pure LIVE
    if (liveQuotes.length === uniq.length) {
      return {
        quotes: liveQuotes,
        meta: buildMeta({
          source: "ssi-ws",
          sourceTimestampMs: newest || Date.now(),
          note: "Quotes LIVE — SSI FastConnect WebSocket",
          slas: { liveSlaMs: 5_000, freshSlaMs: 30_000, delayedSlaMs: 120_000 },
        }),
      };
    }
  }

  // 2) SSI REST
  if (ssiFcConfigured()) {
    try {
      const key = `vn:quotes:ssi:${uniq.slice(0, 20).sort().join(",")}`;
      const res = await cached(key, {
        ttlMs: 12_000,
        staleMs: 24 * 3_600_000,
        producer: async () => {
          const v = await getSsiQuotes(uniq);
          if (!v.quotes.length) throw new Error("ssi empty quotes");
          return { quotes: v.quotes, sourceTs: v.sourceTs };
        },
      });

      // Merge any fresher WS ticks over REST rows
      const bySym = new Map(res.value.quotes.map((q) => [q.symbol, q]));
      if (process.env.SSI_WS_DISABLED !== "true") {
        for (const s of uniq) {
          const live = liveQuoteFromWs(s);
          if (live) bySym.set(s, live);
        }
      }

      return {
        quotes: [...bySym.values()],
        meta: buildMeta({
          source: process.env.SSI_WS_DISABLED === "true" ? "ssi-fcdata" : "ssi-fcdata+ssi-ws",
          sourceTimestampMs: res.value.sourceTs,
          cached: res.cached,
          stale: res.stale,
          note: "Quotes — SSI FastConnect (REST ± WS overlay)",
        }),
      };
    } catch {
      // fall through
    }
  }

  // 3) VNDirect fallback
  try {
    const key = `vn:quotes:vnd:${uniq.slice(0, 30).sort().join(",")}`;
    const res = await cached(key, {
      ttlMs: 15_000,
      staleMs: 24 * 3_600_000,
      producer: async () => {
        const v = await vndirect.getVndQuotes(uniq);
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
  bootSsiLive();
  if (ssiFcConfigured() && process.env.SSI_WS_DISABLED !== "true" && !vndirect.isVnIndexSymbol(sym)) {
    ssiWs.watchSymbol(sym);
  }

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
    notes.push("Nguồn thị trường LIVE: SSI FastConnect (WS→REST) · VNDirect fallback.");
  } else {
    notes.push("Nguồn tạm thời: VNDirect — set SSI_FC_CONSUMER_ID + SSI_FC_CONSUMER_SECRET để bật SSI.");
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
      (ssiFcConfigured() ? "ssi-fcdata|vndirect" : "vndirect"),
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
