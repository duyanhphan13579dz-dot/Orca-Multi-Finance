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
import {
  daysAgoFc,
  fcDayTime,
  getFcDailyOhlc,
  getFcIndices,
  getFcMasterMap,
  getFcOhlc,
  getFcQuotes,
  getFcUniverse,
  ssiFastConfigured,
  type FcMasterRow,
  type FcTimeFrame,
} from "../providers/ssi-fastconnect";
import { STOCK_TFS } from "../chart-const";
import { ensureSsiWsStarted, ssiWs } from "../realtime/ssi-ws";
import { ensureSsiFcStreamStarted, ssiFcStream } from "../realtime/ssi-fc-stream";
import { validateBars, logQualityEvent } from "../quality";
import { analyzeSeries, detectPatterns } from "../technical";
import type { CandlePattern, IndexQuote, Meta, OhlcvBar, Quote, TechnicalSnapshot } from "../types";

/**
 * Vietnam equity domain — provider ladder:
 *   1. SSI FastConnect v3 (developers.ssi.com.vn) — SSI_API_KEY/SECRET
 *   2. SSI FC Data legacy v2 — SSI_FC_CONSUMER_ID/SECRET
 *   3. VNDirect (no key)
 */

const INDEX_PRIORITY = ["VNINDEX", "VN30", "HNX", "UPCOM", "HNX30", "VN100"];

function sortIndices(items: IndexQuote[]): IndexQuote[] {
  return [...items].sort((a, b) => {
    const ia = INDEX_PRIORITY.indexOf(a.code);
    const ib = INDEX_PRIORITY.indexOf(b.code);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

const wsEnabled = () => process.env.SSI_WS_DISABLED !== "true";

function bootSsiLive() {
  if (!wsEnabled()) return;
  try {
    if (ssiFastConfigured()) ensureSsiFcStreamStarted();
    else if (ssiFcConfigured()) ensureSsiWsStarted();
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

export function vnPrimaryProvider(): "ssi-fastconnect" | "ssi-fcdata" | "vndirect" {
  if (ssiFastConfigured()) return "ssi-fastconnect";
  return ssiFcConfigured() ? "ssi-fcdata" : "vndirect";
}

function liveQuoteFromWs(symbol: string): Quote | null {
  // v3 FastConnect stream first, legacy DataHub second
  const t = ssiFastConfigured()
    ? ssiFcStream.getQuote(symbol, 30_000)
    : ssiWs.getQuote(symbol, 30_000);
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

/** SSI v3 index codes can differ from platform codes (HNXINDEX ↔ HNX …). */
const INDEX_ALIASES: Record<string, string[]> = {
  VNINDEX: ["VNINDEX"],
  VN30: ["VN30"],
  VN100: ["VN100"],
  HNX: ["HNXINDEX", "HNX"],
  HNX30: ["HNX30"],
  UPCOM: ["UPCOMINDEX", "UPCOM"],
};

export async function getVnIndices(): Promise<{ items: IndexQuote[]; meta: Meta } | null> {
  bootSsiLive();

  // 1a) LIVE WS — FastConnect v3 stream
  if (ssiFastConfigured() && wsEnabled()) {
    const live: IndexQuote[] = [];
    for (const code of INDEX_PRIORITY) {
      const candidates = INDEX_ALIASES[code] ?? [code];
      const idx = candidates.map((c) => ssiFcStream.getIndex(c, 30_000)).find(Boolean);
      if (!idx) continue;
      live.push({
        code,
        name: code,
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
          source: "ssi-fc-stream",
          sourceTimestampMs: Math.max(...live.map((x) => Date.parse(x.updatedAt ?? "") || 0)),
          note: "Chỉ số LIVE — SSI FastConnect WebSocket",
          slas: { liveSlaMs: 15_000, freshSlaMs: 60_000, delayedSlaMs: 300_000 },
        }),
      };
    }
  }

  // 1b) SSI FastConnect v3 REST — indexSummary
  if (ssiFastConfigured()) {
    try {
      const res = await cached("vn:indices:ssi-fc:v1", {
        ttlMs: 20_000,
        staleMs: 24 * 3_600_000,
        producer: async () => {
          const v = await getFcIndices(INDEX_PRIORITY);
          if (!v.items.length) throw new Error("ssi-fc empty indices");
          return v;
        },
      });
      return {
        items: sortIndices(res.value.items),
        meta: buildMeta({
          source: "ssi-fastconnect",
          sourceTimestampMs: res.value.sourceTs,
          cached: res.cached,
          stale: res.stale,
          note: "Chỉ số VN — SSI FastConnect v3 indexSummary",
          slas: { liveSlaMs: 30_000, freshSlaMs: 300_000, delayedSlaMs: 3_600_000 },
        }),
      };
    } catch {
      /* fall through */
    }
  }

  // 2a) LIVE WS — legacy DataHub
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
          note: "Chỉ số LIVE — SSI DataHub",
          slas: { liveSlaMs: 15_000, freshSlaMs: 60_000, delayedSlaMs: 300_000 },
        }),
      };
    }
  }

  // 2b) SSI REST DailyIndex (legacy v2)
  if (ssiFcConfigured()) {
    try {
      const res = await cached("vn:indices:ssi:v1", {
        ttlMs: 20_000,
        staleMs: 24 * 3_600_000,
        producer: async () => {
          const v = await getSsiIndices(INDEX_PRIORITY);
          if (!v.items.length) throw new Error("ssi empty indices");
          return v;
        },
      });
      return {
        items: sortIndices(res.value.items),
        meta: buildMeta({
          source: "ssi-fcdata",
          sourceTimestampMs: res.value.sourceTs,
          cached: res.cached,
          stale: res.stale,
          note: "Chỉ số VN — SSI FastConnect DailyIndex",
          slas: { liveSlaMs: 30_000, freshSlaMs: 300_000, delayedSlaMs: 3_600_000 },
        }),
      };
    } catch {
      /* fall through */
    }
  }

  // 3) VNDirect fallback
  try {
    const res = await cached("vn:indices:vnd:v1", {
      ttlMs: 45_000,
      staleMs: 24 * 3_600_000,
      producer: () => vndirect.getVndIndices(),
    });
    return {
      items: sortIndices(res.value.items),
      meta: buildMeta({
        source: "vndirect",
        sourceTimestampMs: res.value.sourceTs,
        cached: res.cached,
        stale: res.stale,
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
  universe: { symbol: string; name: string | null; exchange: string | null; industry: string | null }[];
  sessionDate: string;
  meta: Meta;
} | null> {
  bootSsiLive();

  // SSI FastConnect v3 PRIMARY (live WS board + REST bands/indices/universe)
  if (ssiFastConfigured() && wsEnabled()) {
    try {
      const res = await cached("vn:market-board:ssi-fc:v1", {
        ttlMs: 15_000,
        staleMs: 24 * 3_600_000,
        producer: async () => {
          // whole-board subscriptions (fills progressively during the session)
          ssiFcStream.watchBoard("hose");
          ssiFcStream.watchBoard("hnx");
          ssiFcStream.watchBoard("upcom");

          const [live, master, indices, universe] = await Promise.all([
            Promise.resolve(ssiFcStream.getBoardQuotes(60_000)),
            getFcMasterMap().catch(
              () => ({ bySym: new Map<string, FcMasterRow>(), tradingDate: null as string | null }),
            ),
            getFcIndices(INDEX_PRIORITY).catch(() => ({ items: [] as IndexQuote[], sourceTs: null as number | null })),
            cached("vn:universe:ssi-fc:v1", {
              ttlMs: 24 * 3_600_000,
              staleMs: 7 * 24 * 3_600_000,
              producer: () => getFcUniverse(),
            }).then((r) => r.value).catch(() => [] as { symbol: string; name: string | null; exchange: string | null; industry: string | null }[]),
          ]);

          if (live.length < 20) throw new Error(`ssi-fc-stream board too thin (${live.length})`);

          const nameBySym = new Map(universe.map((u) => [u.symbol, u.name]));
          const quotes: Quote[] = live.map((t) => {
            const m = master.bySym.get(t.symbol);
            return {
              symbol: t.symbol,
              name: nameBySym.get(t.symbol) ?? null,
              assetClass: "stock" as const,
              price: t.price,
              change: t.change,
              changePercent: t.changePercent,
              open: t.open,
              high: t.high,
              low: t.low,
              volume: t.volume,
              quoteVolume: t.value,
              referencePrice: t.ref ?? m?.refPrice ?? null,
              ceilingPrice: t.ceiling ?? m?.ceiling ?? null,
              floorPrice: t.floor ?? m?.floor ?? null,
              updatedAt: new Date(t.eventTime).toISOString(),
            };
          });

          return {
            quotes,
            indices: sortIndices(indices.items),
            universe,
            sessionDate: master.tradingDate ?? new Date().toISOString().slice(0, 10),
            sourceTs: Math.max(...live.map((t) => t.eventTime)),
          };
        },
      });

      return {
        quotes: res.value.quotes,
        indices: res.value.indices,
        universe: res.value.universe,
        sessionDate: res.value.sessionDate,
        meta: buildMeta({
          source: "ssi-fastconnect+ssi-fc-stream",
          sourceTimestampMs: res.value.sourceTs,
          cached: res.cached,
          stale: res.stale,
          note: `Phiên ${res.value.sessionDate} · ${res.value.quotes.length} mã LIVE · SSI FastConnect v3 PRIMARY`,
          slas: { liveSlaMs: 15_000, freshSlaMs: 120_000, delayedSlaMs: 6 * 3_600_000 },
        }),
      };
    } catch {
      /* fall through: legacy SSI board → VNDirect */
    }
  }

  // SSI PRIMARY (legacy v2): full board + indices + universe
  if (ssiFcConfigured()) {
    try {
      const res = await cached("vn:market-board:ssi:v2", {
        ttlMs: 20_000,
        staleMs: 24 * 3_600_000,
        producer: async () => {
          const [board, indices, universe] = await Promise.all([
            getSsiFullBoard(),
            getSsiIndices(INDEX_PRIORITY).catch(() => ({
              items: [] as IndexQuote[],
              sourceTs: null as number | null,
            })),
            getSsiUniverse().catch(
              () =>
                [] as {
                  symbol: string;
                  name: string | null;
                  exchange: string | null;
                  industry: string | null;
                }[],
            ),
          ]);

          const bySym = new Map(universe.map((u) => [u.symbol, u]));
          let quotes = board.quotes.map((q) => {
            const u = bySym.get(q.symbol);
            return u ? { ...q, name: q.name ?? u.name } : q;
          });

          if (process.env.SSI_WS_DISABLED !== "true") {
            quotes = quotes.map((q) => {
              const live = liveQuoteFromWs(q.symbol);
              return live ? { ...q, ...live, name: q.name } : q;
            });
          }

          if (!quotes.length) throw new Error("ssi empty board");

          return {
            quotes,
            indices: sortIndices(indices.items),
            universe,
            sessionDate: board.sessionDate,
            sourceTs: board.sourceTs ?? indices.sourceTs,
          };
        },
      });

      return {
        quotes: res.value.quotes,
        indices: res.value.indices,
        universe: res.value.universe,
        sessionDate: res.value.sessionDate,
        meta: buildMeta({
          source: process.env.SSI_WS_DISABLED === "true" ? "ssi-fcdata" : "ssi-fcdata+ssi-ws",
          sourceTimestampMs: res.value.sourceTs,
          cached: res.cached,
          stale: res.stale,
          note: `Phiên ${res.value.sessionDate} · ${res.value.quotes.length} mã · SSI FastConnect PRIMARY`,
          slas: { liveSlaMs: 30_000, freshSlaMs: 300_000, delayedSlaMs: 6 * 3_600_000 },
        }),
      };
    } catch {
      /* fall through VNDirect */
    }
  }

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

    return {
      quotes: res.value.quotes,
      indices: res.value.indices,
      universe: res.value.universe,
      sessionDate: res.value.sessionDate,
      meta: buildMeta({
        source: "vndirect",
        sourceTimestampMs: res.value.sourceTs,
        cached: res.cached,
        stale: res.stale,
        note: ssiFcConfigured()
          ? `Fallback VNDirect · phiên ${res.value.sessionDate}`
          : `Phiên ${res.value.sessionDate} · VNDirect`,
        slas: { liveSlaMs: 60_000, freshSlaMs: 600_000, delayedSlaMs: 6 * 3_600_000 },
      }),
    };
  } catch {
    return null;
  }
}

export async function getVnUniverseList(): Promise<
  | { items: { symbol: string; name: string | null; exchange: string | null; industry: string | null }[]; meta: Meta }
  | null
> {
  if (ssiFastConfigured()) {
    try {
      const res = await cached("vn:universe:ssi-fc:v1", {
        ttlMs: 6 * 3_600_000,
        staleMs: 7 * 24 * 3_600_000,
        producer: () => getFcUniverse(),
      });
      return {
        items: res.value,
        meta: buildMeta({
          source: "ssi-fastconnect",
          sourceTimestampMs: Date.now(),
          cached: res.cached,
          stale: res.stale,
          note: "Universe HOSE/HNX/UPCoM — SSI securitiesByBoard (ICB industry)",
        }),
      };
    } catch {
      /* fall through */
    }
  }

  if (ssiFcConfigured()) {
    try {
      const res = await cached("vn:universe:ssi:v1", {
        ttlMs: 6 * 3_600_000,
        staleMs: 7 * 24 * 3_600_000,
        producer: () => getSsiUniverse(),
      });
      return {
        items: res.value,
        meta: buildMeta({
          source: "ssi-fcdata",
          sourceTimestampMs: Date.now(),
          cached: res.cached,
          stale: res.stale,
          note: "Universe HOSE/HNX/UPCoM — SSI Securities",
        }),
      };
    } catch {
      /* fall through */
    }
  }

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

  // 1) SSI FastConnect v3 — LIVE WS then REST securitiesSummary
  if (ssiFastConfigured()) {
    if (wsEnabled()) for (const s of uniq) ssiFcStream.watchSymbol(s);

    if (wsEnabled()) {
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
      if (liveQuotes.length === uniq.length) {
        return {
          quotes: liveQuotes,
          meta: buildMeta({
            source: "ssi-fc-stream",
            sourceTimestampMs: newest || Date.now(),
            note: "Quotes LIVE — SSI FastConnect WebSocket",
            slas: { liveSlaMs: 5_000, freshSlaMs: 30_000, delayedSlaMs: 120_000 },
          }),
        };
      }
    }

    try {
      const key = `vn:quotes:ssi-fc:${uniq.slice(0, 20).sort().join(",")}`;
      const res = await cached(key, {
        ttlMs: 12_000,
        staleMs: 24 * 3_600_000,
        producer: async () => {
          const v = await getFcQuotes(uniq);
          if (!v.quotes.length) throw new Error("ssi-fc empty quotes");
          return { quotes: v.quotes, sourceTs: v.sourceTs };
        },
      });

      const bySym = new Map(res.value.quotes.map((q) => [q.symbol, q]));
      if (wsEnabled()) {
        for (const s of uniq) {
          const live = liveQuoteFromWs(s);
          if (live) bySym.set(s, live);
        }
      }

      return {
        quotes: [...bySym.values()],
        meta: buildMeta({
          source: wsEnabled() ? "ssi-fastconnect+ssi-fc-stream" : "ssi-fastconnect",
          sourceTimestampMs: res.value.sourceTs,
          cached: res.cached,
          stale: res.stale,
          note: "Quotes — SSI FastConnect v3 securitiesSummary",
        }),
      };
    } catch {
      /* fall through legacy/VNDirect */
    }
  }

  // 2) Legacy SSI DataHub WS
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
    if (liveQuotes.length === uniq.length) {
      return {
        quotes: liveQuotes,
        meta: buildMeta({
          source: "ssi-ws",
          sourceTimestampMs: newest || Date.now(),
          note: "Quotes LIVE — SSI DataHub",
          slas: { liveSlaMs: 5_000, freshSlaMs: 30_000, delayedSlaMs: 120_000 },
        }),
      };
    }
  }

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
          note: "Quotes — SSI FastConnect",
        }),
      };
    } catch {
      /* fall through */
    }
  }

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
  const isIndex = vndirect.isVnIndexSymbol(sym);

  if (ssiFastConfigured() && wsEnabled() && !isIndex) {
    ssiFcStream.watchSymbol(sym);
  }

  // 1) SSI FastConnect v3 — /api/v3/data/ohlc (1d)
  if (ssiFastConfigured()) {
    try {
      const res = await cached(`vn:ohlcv:ssi-fc:${sym}:${limit}`, {
        ttlMs: 60_000,
        staleMs: 7 * 24 * 3_600_000,
        producer: async () => {
          const bars = await getFcDailyOhlc(sym);
          const q = validateBars(bars.slice(-limit));
          if (q.status !== "VALID") void logQualityEvent("ssi-fastconnect", `ohlcv:${sym}`, q);
          if (q.status === "INVALID") throw new Error("invalid ohlcv series");
          return {
            bars: q.cleaned,
            fetchedAt: Date.now(),
            source: "ssi-fastconnect" as const,
            note: isIndex ? "OHLCV chỉ số — SSI FastConnect v3" : "OHLCV cổ phiếu — SSI FastConnect v3",
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
      /* fall through */
    }
  }

  // 2) SSI legacy DailyOhlc (works for stocks; indices too)
  if (ssiFcConfigured()) {
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
            note: isIndex ? "OHLCV chỉ số — SSI" : "OHLCV cổ phiếu — SSI FastConnect",
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
      /* fall through */
    }
  }

  try {
    const res = await cached(`vn:ohlcv:vnd:${sym}:${limit}`, {
      ttlMs: 60_000,
      staleMs: 7 * 24 * 3_600_000,
      producer: async () => {
        const bars = isIndex
          ? await vndirect.getVndIndexOhlcv(sym, limit)
          : await vndirect.getVndOhlcv(sym, limit);
        const q = validateBars(bars);
        if (q.status !== "VALID") void logQualityEvent("vndirect", `ohlcv:${sym}`, q);
        if (q.status === "INVALID") throw new Error("invalid ohlcv series");
        return {
          bars: q.cleaned,
          fetchedAt: Date.now(),
          source: "vndirect" as const,
          note: isIndex ? "OHLCV chỉ số VNDirect" : "OHLCV cổ phiếu VNDirect",
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

/** Intraday timeframes available for VN equities via SSI FastConnect v3 OHLC. */
export const VN_INTRADAY_TFS = ["1m", "3m", "5m", "15m", "30m", "1h"] as const;

/** Chart timeframes allowed for the stock asset class, given the provider ladder. */
export function vnStockTimeframes(): readonly string[] {
  return ssiFastConfigured() ? [...VN_INTRADAY_TFS, ...STOCK_TFS] : STOCK_TFS;
}

/**
 * Intraday OHLCV for a VN equity via SSI FastConnect v3 `data/ohlc`.
 * SSI serves the last 12 months of intraday data; we fetch a bounded window
 * sized for the requested timeframe + limit.
 */
export async function getVnIntradayOhlcv(
  symbol: string,
  timeframe: (typeof VN_INTRADAY_TFS)[number],
  limit = 500,
): Promise<{ bars: OhlcvBar[]; meta: Meta } | null> {
  if (!ssiFastConfigured()) return null;
  const sym = symbol.toUpperCase();
  bootSsiLive();
  if (wsEnabled()) ssiFcStream.watchSymbol(sym);

  const tfMinutes: Record<(typeof VN_INTRADAY_TFS)[number], number> = {
    "1m": 1,
    "3m": 3,
    "5m": 5,
    "15m": 15,
    "30m": 30,
    "1h": 60,
  };
  const barsPerDay = Math.max(1, Math.floor(255 / tfMinutes[timeframe])); // ~255 matching minutes/session
  const days = Math.min(365, Math.ceil((limit * 1.4) / barsPerDay) + 2);

  try {
    const res = await cached(`vn:intraday:ssi-fc:${sym}:${timeframe}:${limit}`, {
      ttlMs: timeframe === "1m" ? 20_000 : timeframe === "3m" ? 45_000 : 90_000,
      staleMs: 24 * 3_600_000,
      producer: async () => {
        const bars = await getFcOhlc(sym, {
          timeFrame: timeframe as FcTimeFrame,
          from: `${daysAgoFc(days)} 09:00:00`,
          to: fcDayTime(),
          pageSize: 1000,
        });
        const q = validateBars(bars.slice(-limit));
        if (q.status !== "VALID") void logQualityEvent("ssi-fastconnect", `intraday:${sym}:${timeframe}`, q);
        if (q.status === "INVALID") throw new Error("invalid intraday series");
        return { bars: q.cleaned, fetchedAt: Date.now(), qualityStatus: q.status };
      },
    });
    const last = res.value.bars[res.value.bars.length - 1];
    const meta = buildMeta({
      source: "ssi-fastconnect",
      sourceTimestampMs: last?.time ?? res.value.fetchedAt,
      cached: res.cached,
      stale: res.stale,
      note: `Nến intraday ${timeframe} — SSI FastConnect v3`,
      slas: {
        liveSlaMs: tfMinutes[timeframe] * 60_000,
        freshSlaMs: tfMinutes[timeframe] * 60_000 * 4,
        delayedSlaMs: tfMinutes[timeframe] * 60_000 * 12,
      },
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
  if (wsEnabled()) {
    if (ssiFastConfigured()) ssiFcStream.watchSymbol(sym);
    else if (ssiFcConfigured()) ssiWs.watchSymbol(sym);
  }

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

  // notes chỉ dành cho agent/intelligence engine — KHÔNG render ra UI.
  const notes: string[] = [];
  if (failed.length) notes.push(`Một số bộ dữ liệu chưa khả dụng: ${failed.join(", ")}`);
  if (fin?.notes?.length) notes.push(...fin.notes);

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
      vnPrimaryProvider(),
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
