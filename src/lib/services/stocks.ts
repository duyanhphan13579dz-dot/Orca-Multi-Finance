import "server-only";
import { env } from "../env";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { getFinancialsForSymbol, vnProviderLayout } from "../financial";
import type { FinancialPackageMeta, GrowthSnapshot, NormalizedPeriod } from "../financial/types";
import type { FinancialHealthResult } from "../engines/fundamental";
import * as vndirect from "../providers/vndirect";
import {
  getSsiIndices,
  getSsiQuotes,
  ssiFcConfigured,
} from "../providers/ssi-fcdata";
import { ensureSsiWsStarted, ssiWs } from "../realtime/ssi-ws";
import { bootSsiMarketDataPipeline } from "../realtime/ssi-market-boot";
import { ensureVndirectWsStarted, vndirectWs } from "../realtime/vndirect-ws";
import { isRealtimeWsDisabled } from "../realtime/ws-policy";
import { analyzeSeries, detectPatterns } from "../technical";
import { computeAlphaBeta } from "../engines/alpha-beta";
import type { CandlePattern, IndexQuote, Meta, OhlcvBar, Quote, TechnicalSnapshot } from "../types";
import {
  getVndCompanyProfile,
  getVndEquitySnapshot,
  type VndCompanyProfile,
  type VndEquitySnapshot,
} from "../providers/vndirect-company";
import { getVndSymbolForeignFlow } from "../providers/vndirect-foreign-symbol";
import { getVnOrderBook, type VnOrderBook } from "./stock-orderbook";
import { getMultiQuotes } from "./multi-quote";
import {
  getPublicIndices,
  getPublicQuotes,
  getPublicOhlcv,
  LIQUID_BOARD,
} from "../providers/public-vn-feed";

const INDEX_PRIORITY = ["VNINDEX", "VN30", "HNX", "UPCOM", "HNX30", "VN100"];

function sortIndices(items: IndexQuote[]): IndexQuote[] {
  return [...items].sort((a, b) => {
    const ia = INDEX_PRIORITY.indexOf(a.code);
    const ib = INDEX_PRIORITY.indexOf(b.code);
    if (ia < 0 && ib < 0) return a.code.localeCompare(b.code);
    if (ia < 0) return 1;
    if (ib < 0) return -1;
    return ia - ib;
  });
}

export function vnMarketConfigured(): boolean {
  return true;
}

export function vnstockConfigured(): boolean {
  return true;
}

export function vnPrimaryProvider(): "ssi-fcdata" | "vndirect" {
  return ssiFcConfigured() ? "ssi-fcdata" : "vndirect";
}

export async function getVnIndices(): Promise<{ items: IndexQuote[]; meta: Meta } | null> {
  try {
    if (ssiFcConfigured()) {
      const ssi = await getSsiIndices().catch(() => null);
      if (ssi?.items?.length) {
        return {
          items: sortIndices(ssi.items),
          meta: buildMeta({ source: "ssi-fcdata", sourceTimestampMs: Date.now() }),
        };
      }
    }
    const vnd = await vndirect.getVndIndices().catch(() => null);
    if (vnd?.items?.length) {
      return {
        items: sortIndices(vnd.items),
        meta: buildMeta({ source: "vndirect", sourceTimestampMs: vnd.sourceTs ?? Date.now() }),
      };
    }
    const pub = await getPublicIndices().catch(() => null);
    const pubItems = Array.isArray(pub) ? pub : pub?.items;
    if (pubItems?.length) {
      return {
        items: sortIndices(pubItems),
        meta: buildMeta({
          source: "public-indices",
          sourceTimestampMs: (pub as { sourceTs?: number })?.sourceTs ?? Date.now(),
        }),
      };
    }
  } catch {
    /* */
  }
  return null;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  try {
    return await Promise.race([
      p,
      new Promise<null>((r) => setTimeout(() => r(null), ms)),
    ]);
  } catch {
    return null;
  }
}

/** Parallel multi-source quotes — first non-empty wins; always tries public last. */
export async function getVnQuotes(symbols: string[]): Promise<{ quotes: Quote[]; meta: Meta } | null> {
  const syms = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
  if (!syms.length) return { quotes: [], meta: buildMeta({ source: "empty", sourceTimestampMs: Date.now() }) };

  type Pack = { quotes: Quote[]; source: string; sourceTs?: number | null };

  const tasks: Promise<Pack | null>[] = [];

  if (ssiFcConfigured()) {
    tasks.push(
      withTimeout(
        getSsiQuotes(syms).then((r) =>
          r?.quotes?.length ? { quotes: r.quotes, source: "ssi-fcdata", sourceTs: Date.now() } : null,
        ),
        4_500,
      ),
    );
  }

  tasks.push(
    withTimeout(
      vndirect.getVndQuotes(syms).then((r) =>
        r?.quotes?.length
          ? { quotes: r.quotes, source: "vndirect", sourceTs: r.sourceTs ?? Date.now() }
          : null,
      ),
      5_000,
    ),
  );

  tasks.push(
    withTimeout(
      getMultiQuotes(syms).then((r) =>
        r?.quotes?.length ? { quotes: r.quotes, source: "multi-quote", sourceTs: Date.now() } : null,
      ),
      7_500,
    ),
  );

  tasks.push(
    withTimeout(
      getPublicQuotes(syms).then((r) =>
        r?.quotes?.length
          ? {
              quotes: r.quotes,
              source: (r.sources ?? []).join("+") || "public-vn",
              sourceTs: r.sourceTs ?? Date.now(),
            }
          : null,
      ),
      5_500,
    ),
  );

  const settled = await Promise.all(tasks);
  for (const preferred of ["ssi-fcdata", "vndirect", "multi-quote", "public-vn"]) {
    const hit = settled.find(
      (x) => x && x.quotes.length && (x.source === preferred || x.source.startsWith(preferred)),
    );
    if (hit) {
      return {
        quotes: hit.quotes,
        meta: buildMeta({ source: hit.source, sourceTimestampMs: hit.sourceTs ?? Date.now() }),
      };
    }
  }
  const any = settled.find((x) => x && x.quotes.length);
  if (any) {
    return {
      quotes: any.quotes,
      meta: buildMeta({ source: any.source, sourceTimestampMs: any.sourceTs ?? Date.now() }),
    };
  }
  return null;
}

export async function getVnOhlcv(
  symbol: string,
  limit = 260,
): Promise<{ bars: OhlcvBar[]; meta: Meta } | null> {
  const sym = symbol.toUpperCase();
  const isIndex = vndirect.isVnIndexSymbol(sym);
  try {
    let ohlcvTtl = 30_000;
    let ohlcvStale = 180_000;
    try {
      const { getVnSession } = await import("../vn/sessions");
      if (getVnSession().trading) {
        ohlcvTtl = 12_000;
        ohlcvStale = 90_000;
      }
    } catch {
      /* */
    }
    const res = await cached(`vn:ohlcv:vnd:${sym}:${limit}`, {
      ttlMs: ohlcvTtl,
      staleMs: ohlcvStale,
      softSwr: true,
      producer: async () => {
        try {
          const bars = await Promise.race([
            isIndex ? vndirect.getVndIndexOhlcv(sym, limit) : vndirect.getVndOhlcv(sym, limit),
            new Promise<null>((r) => setTimeout(() => r(null), 8_000)),
          ]);
          if (bars?.length) return bars;
        } catch {
          /* */
        }
        const pub = await getPublicOhlcv(sym, limit, isIndex ? "index" : "stock");
        if (!pub.length) throw new Error(`ohlcv empty ${sym}`);
        return pub;
      },
    });
    return {
      bars: res.value,
      meta: buildMeta({
        source: "vndirect-ohlcv",
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
    } catch {
      /* */
    }
    return null;
  }
}

export async function getVnMarketBoard(): Promise<{
  quotes: Quote[];
  indices: IndexQuote[];
  meta: Meta;
} | null> {
  try {
    const [idx, q] = await Promise.all([
      getVnIndices(),
      getVnQuotes(LIQUID_BOARD.slice(0, 80)),
    ]);
    const quotes = q?.quotes ?? [];
    const indices = idx?.items ?? [];
    if (!quotes.length && !indices.length) return null;
    return {
      quotes,
      indices,
      meta: buildMeta({
        source: [q?.meta?.source, idx?.meta?.source].filter(Boolean).join("+") || "vn-board",
        sourceTimestampMs: Date.now(),
      }),
    };
  } catch {
    return null;
  }
}

export async function getVnUniverseList(): Promise<{
  symbols: string[];
  meta: Meta;
} | null> {
  return {
    symbols: [...LIQUID_BOARD],
    meta: buildMeta({ source: "liquid-board", sourceTimestampMs: Date.now() }),
  };
}

export interface VnStockDetail {
  symbol: string;
  name: string | null;
  quote: Quote | null;
  bars: OhlcvBar[];
  technical: TechnicalSnapshot | null;
  patterns: CandlePattern[];
  equity: VndEquitySnapshot | null;
  sharesOutstanding: number | null;
  profile: VndCompanyProfile | null;
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

  const [quoteRes, ohlcvRes, profileRes, equityRes, bookRes, foreignRes, finRes] = await Promise.all([
    getVnQuotes([sym]).catch(() => null),
    getVnOhlcv(sym, 320),
    getVndCompanyProfile(sym).catch(() => null),
    getVndEquitySnapshot(sym).catch(() => null),
    getVnOrderBook(sym).catch(() => null),
    getVndSymbolForeignFlow(sym).catch(() => null),
    getFinancialsForSymbol(sym).catch(() => null),
  ]);

  const quote = quoteRes?.quotes?.[0] ?? null;
  if (!quote) failed.push("quote");
  const name = quote?.name ?? profileRes?.name ?? null;
  const bars = ohlcvRes?.bars ?? [];
  if (!bars.length) failed.push("ohlcv");

  const profile = profileRes;
  const equity = equityRes;
  const sharesOutstanding =
    equity && typeof (equity as { sharesOutstanding?: number }).sharesOutstanding === "number"
      ? (equity as { sharesOutstanding: number }).sharesOutstanding
      : null;
  const orderBook = bookRes;

  const foreignFlow = foreignRes
    ? { latest: (foreignRes as { latest?: unknown }).latest, history: (foreignRes as { history?: unknown }).history }
    : null;
  if (!foreignFlow?.latest) failed.push("foreign");

  let technical: TechnicalSnapshot | null = null;
  let patterns: CandlePattern[] = [];
  if (bars.length >= 20) {
    try {
      technical = analyzeSeries(bars);
      patterns = detectPatterns(bars);
    } catch {
      /* */
    }
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
    } catch {
      /* */
    }
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
      source: [quoteRes?.meta?.source, ohlcvRes?.meta?.source].filter(Boolean).join("+") || "vndirect",
      sourceTimestampMs: Date.now(),
      note: notes.length ? notes.join(" · ") : undefined,
      partial: failed.length > 0,
    }),
  };
}

function emptyStockDetail(sym: string): VnStockDetail {
  return {
    symbol: sym,
    name: null,
    quote: null,
    bars: [],
    technical: null,
    patterns: [],
    equity: null,
    sharesOutstanding: null,
    profile: null,
    orderBook: null,
    foreignFlow: null,
    financials: { income: null, balance: null, cashflow: null, ratios: null },
    financialHealth: null,
    financialMeta: null,
    financialGrowth: null,
    financialTtm: null,
    detailedRatios: null,
    ratioMap: {},
    metricsSources: [],
    notes: ["Nguồn tạm gián đoạn — đang thử lại."],
  };
}

export async function getVnStockDetail(
  symbol: string,
): Promise<{ detail: VnStockDetail; meta: Meta } | null> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return null;
  let ttl = 20_000;
  let stale = 120_000;
  try {
    const { getVnSession } = await import("../vn/sessions");
    if (getVnSession().trading) {
      ttl = 10_000;
      stale = 75_000;
    }
  } catch {
    /* */
  }
  try {
    const res = await cached<{ detail: VnStockDetail; meta: Meta } | null>(`vn:stock-detail:${sym}:v4`, {
      ttlMs: ttl,
      staleMs: stale,
      softSwr: true,
      producer: async () => {
        try {
          return await produceVnStockDetail(sym);
        } catch (e) {
          console.warn("[produceVnStockDetail]", sym, e instanceof Error ? e.message : e);
          return {
            detail: emptyStockDetail(sym),
            meta: buildMeta({
              source: "degraded",
              sourceTimestampMs: Date.now(),
              note: "producer error — degraded shell",
              partial: true,
            }),
          };
        }
      },
    });
    if (res.value?.detail) return { detail: res.value.detail, meta: res.value.meta };
  } catch (e) {
    console.warn("[getVnStockDetail cache]", sym, e instanceof Error ? e.message : e);
  }
  try {
    const direct = await produceVnStockDetail(sym);
    if (direct) return direct;
  } catch {
    /* */
  }
  return {
    detail: emptyStockDetail(sym),
    meta: buildMeta({
      source: "degraded",
      sourceTimestampMs: Date.now(),
      note: "all providers unavailable",
      partial: true,
    }),
  };
}

export { getVnOrderBook, type VnOrderBook } from "./stock-orderbook";
export { vnProviderLayout };
