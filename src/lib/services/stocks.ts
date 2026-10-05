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

export async function getVnIndices(): Promise<{ items: IndexQuote[]; meta: Meta } | null> {
  try {
    const tasks: Promise<{ items: IndexQuote[]; source: string; ts?: number } | null>[] = [];
    if (ssiFcConfigured()) {
      tasks.push(
        withTimeout(
          getSsiIndices().then((r) =>
            r?.items?.length ? { items: r.items, source: "ssi-fcdata", ts: Date.now() } : null,
          ),
          4_000,
        ),
      );
    }
    tasks.push(
      withTimeout(
        vndirect.getVndIndices().then((r) =>
          r?.items?.length
            ? { items: r.items, source: "vndirect", ts: r.sourceTs ?? Date.now() }
            : null,
        ),
        5_000,
      ),
    );
    tasks.push(
      withTimeout(
        getPublicIndices().then((pub) => {
          const items = Array.isArray(pub) ? pub : pub?.items;
          return items?.length
            ? {
                items,
                source: "public-indices",
                ts: (pub as { sourceTs?: number })?.sourceTs ?? Date.now(),
              }
            : null;
        }),
        5_000,
      ),
    );
    const settled = await Promise.all(tasks);
    const byCode = new Map<string, IndexQuote>();
    const sources: string[] = [];
    let newest = Date.now();
    for (const pack of settled) {
      if (!pack?.items?.length) continue;
      sources.push(pack.source);
      if (pack.ts) newest = Math.max(newest, pack.ts);
      for (const it of pack.items) {
        const code = String(it.code ?? "").toUpperCase();
        if (!code) continue;
        const prev = byCode.get(code);
        if (!prev || (it.value != null && it.value > 0)) byCode.set(code, it);
      }
    }
    if (!byCode.size) return null;
    return {
      items: sortIndices([...byCode.values()]),
      meta: buildMeta({
        source: sources.join("+") || "indices",
        sourceTimestampMs: newest,
      }),
    };
  } catch {
    return null;
  }
}

function mergeQuotePacks(
  packs: Array<{ quotes: Quote[]; source: string; sourceTs?: number | null } | null | undefined>,
): { quotes: Quote[]; sources: string[]; newest: number } {
  const bySym = new Map<string, Quote>();
  const used: string[] = [];
  let newest = Date.now();
  for (const pack of packs) {
    if (!pack?.quotes?.length) continue;
    used.push(pack.source);
    if (pack.sourceTs) newest = Math.max(newest, pack.sourceTs);
    for (const q of pack.quotes) {
      const sym = String(q.symbol ?? "").toUpperCase();
      if (!sym || !(Number(q.price) > 0)) continue;
      const prev = bySym.get(sym);
      if (!prev) {
        bySym.set(sym, { ...q, symbol: sym });
        continue;
      }
      bySym.set(sym, {
        ...q,
        ...prev,
        name: prev.name ?? q.name,
        volume: prev.volume ?? q.volume,
        quoteVolume: prev.quoteVolume ?? q.quoteVolume,
        open: prev.open ?? q.open,
        high: prev.high ?? q.high,
        low: prev.low ?? q.low,
        change: prev.change ?? q.change,
        changePercent: prev.changePercent ?? q.changePercent,
        referencePrice: prev.referencePrice ?? q.referencePrice,
        ceilingPrice: prev.ceilingPrice ?? q.ceilingPrice,
        floorPrice: prev.floorPrice ?? q.floorPrice,
      });
    }
  }
  return { quotes: [...bySym.values()], sources: used, newest };
}

/**
 * Parallel multi-source quotes — MERGE coverage from all healthy sources.
 * Never returns null (empty pack + meta instead).
 */
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
        5_000,
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
      5_500,
    ),
  );

  tasks.push(
    withTimeout(
      getMultiQuotes(syms).then((r) =>
        r?.quotes?.length ? { quotes: r.quotes, source: "multi-quote", sourceTs: Date.now() } : null,
      ),
      8_000,
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
      6_500,
    ),
  );

  try {
    const { getVietcapQuotes } = await import("../providers/vietcap");
    tasks.push(
      withTimeout(
        getVietcapQuotes(syms.slice(0, 20)).then((r) =>
          r?.quotes?.length ? { quotes: r.quotes, source: "vietcap", sourceTs: r.sourceTs ?? Date.now() } : null,
        ),
        6_000,
      ),
    );
  } catch {
    /* optional */
  }

  const settled = await Promise.all(tasks);
  const order = ["ssi-fcdata", "vndirect", "multi-quote", "public-vn", "vps", "ssi-iboard", "vietcap"];
  const ranked = [...settled].filter(Boolean).sort((a, b) => {
    const ia = order.findIndex((x) => a!.source === x || a!.source.startsWith(x));
    const ib = order.findIndex((x) => b!.source === x || b!.source.startsWith(x));
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  }) as Pack[];

  const merged = mergeQuotePacks(ranked);
  if (!merged.quotes.length) {
    return {
      quotes: [],
      meta: buildMeta({
        source: "unavailable",
        sourceTimestampMs: Date.now(),
        note: "all quote sources empty",
        partial: true,
      }),
    };
  }
  return {
    quotes: merged.quotes,
    meta: buildMeta({
      source: merged.sources.join("+") || "vn-quotes",
      sourceTimestampMs: merged.newest,
      partial: merged.quotes.length < syms.length,
    }),
  };
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
        const [vndBars, pubBars] = await Promise.all([
          Promise.race([
            (isIndex ? vndirect.getVndIndexOhlcv(sym, limit) : vndirect.getVndOhlcv(sym, limit)).catch(
              () => null,
            ),
            new Promise<null>((r) => setTimeout(() => r(null), 7_500)),
          ]),
          getPublicOhlcv(sym, limit, isIndex ? "index" : "stock").catch(() => [] as OhlcvBar[]),
        ]);
        if (vndBars?.length) return vndBars;
        if (pubBars?.length) return pubBars;
        throw new Error(`ohlcv empty ${sym}`);
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
  indices: IndexQuote[];
  quotes: Quote[];
  meta: Meta;
} | null> {
  try {
    const [idx, q] = await Promise.all([getVnIndices(), getVnQuotes(LIQUID_BOARD)]);
    const indices = idx?.items ?? [];
    const quotes = q?.quotes ?? [];
    if (!indices.length && !quotes.length) return null;
    return {
      indices,
      quotes,
      meta: buildMeta({
        source: [idx?.meta.source, q?.meta.source].filter(Boolean).join("+") || "board",
        sourceTimestampMs: Date.now(),
        partial: !indices.length || !quotes.length,
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
  try {
    const board = await getVnMarketBoard();
    const symbols = [...new Set((board?.quotes ?? []).map((q) => q.symbol).filter(Boolean))];
    if (!symbols.length) {
      return {
        symbols: [...LIQUID_BOARD],
        meta: buildMeta({ source: "liquid-board-fallback", sourceTimestampMs: Date.now(), partial: true }),
      };
    }
    return {
      symbols,
      meta: board?.meta ?? buildMeta({ source: "board", sourceTimestampMs: Date.now() }),
    };
  } catch {
    return {
      symbols: [...LIQUID_BOARD],
      meta: buildMeta({ source: "liquid-board-fallback", sourceTimestampMs: Date.now(), partial: true }),
    };
  }
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
  const name = quote?.name ?? (profileRes as { vnName?: string } | null)?.vnName ?? null;
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
        const ab = computeAlphaBeta(
          bars.map((b) => b.close),
          mkt.map((b) => b.close),
        );
        if (ab) {
          technical = {
            ...technical,
            alpha: ab.alpha,
            beta: ab.beta,
            alphaBetaR2: ab.r2,
          } as TechnicalSnapshot;
        }
      }
    } catch {
      /* */
    }
  }

  let financialHealth: FinancialHealthResult | null = null;
  let financialMeta: FinancialPackageMeta | null = null;
  let financialGrowth: GrowthSnapshot | null = null;
  let financialTtm: NormalizedPeriod | null = null;
  let detailedRatios: unknown = null;
  let ratioMap: Record<string, unknown> = {};
  const metricsSources: string[] = [];
  let financials: unknown = { income: null, balance: null, cashflow: null, ratios: null };

  if (finRes) {
    try {
      financials = finRes;
      financialMeta = (finRes as { meta?: FinancialPackageMeta }).meta ?? null;
      financialHealth = (finRes as { health?: FinancialHealthResult }).health ?? null;
      financialGrowth = (finRes as { growth?: GrowthSnapshot }).growth ?? null;
      financialTtm = (finRes as { ttm?: NormalizedPeriod }).ttm ?? null;
      detailedRatios = (finRes as { detailedRatios?: unknown }).detailedRatios ?? null;
      ratioMap = ((finRes as { ratioMap?: Record<string, unknown> }).ratioMap ?? {}) as Record<
        string,
        unknown
      >;
      const src = financialMeta?.source;
      if (src) metricsSources.push(String(src));
    } catch {
      failed.push("financials");
    }
  } else {
    failed.push("financials");
  }

  if (failed.length) notes.push(`Thiếu: ${failed.join(", ")}`);

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
    financials,
    financialHealth,
    financialMeta,
    financialGrowth,
    financialTtm,
    detailedRatios,
    ratioMap,
    metricsSources,
    notes,
  };

  return {
    detail,
    meta: buildMeta({
      source: [quoteRes?.meta.source, ohlcvRes?.meta.source].filter(Boolean).join("+") || "vndirect",
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
    const res = await cached<{ detail: VnStockDetail; meta: Meta } | null>(`vn:stock-detail:${sym}:v5`, {
      ttlMs: ttl,
      staleMs: stale,
      softSwr: true,
      producer: async () => {
        const r = await produceVnStockDetail(sym);
        if (!r) throw new Error(`detail empty ${sym}`);
        return r;
      },
    });
    return res.value;
  } catch {
    try {
      const r = await produceVnStockDetail(sym);
      if (r) return r;
    } catch {
      /* */
    }
    return {
      detail: emptyStockDetail(sym),
      meta: buildMeta({
        source: "degraded",
        sourceTimestampMs: Date.now(),
        note: "partial shell",
        partial: true,
      }),
    };
  }
}

// Boot realtime pipelines (idempotent)
try {
  if (!isRealtimeWsDisabled()) {
    ensureSsiWsStarted();
    ensureVndirectWsStarted();
    void bootSsiMarketDataPipeline();
  }
} catch {
  /* */
}

void env;
void vnProviderLayout;
void ssiWs;
void vndirectWs;
