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
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

function bootSsiLive() {
  if (!ssiFcConfigured()) return;
  if (isRealtimeWsDisabled("SSI_WS_DISABLED")) return;
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

function bootVndLive() {
  if (isRealtimeWsDisabled("VNDIRECT_WS_DISABLED")) return;
  try {
    ensureVndirectWsStarted();
    vndirectWs.ensureCoreIndices();
  } catch {
    /* non-fatal on serverless */
  }
}

export function vnMarketConfigured(): boolean {
  return true;
}

export function vnstockConfigured(): boolean {
  return Boolean(env.vnstockApiKey && env.vnstockBaseUrl);
}

export function vnPrimaryProvider(): "ssi-fcdata" | "vndirect" {
  return "vndirect";
}

export async function getVnIndices(): Promise<{ items: IndexQuote[]; meta: Meta } | null> {
  bootVndLive();
  try {
    const r = await vndirect.getVndIndices();
    if (r.items?.length) {
      return {
        items: sortIndices(r.items),
        meta: buildMeta({ source: "vndirect", sourceTimestampMs: r.sourceTs ?? Date.now() }),
      };
    }
  } catch {
    /* use public fallback */
  }
  try {
    const fallback = await getPublicIndices();
    if (fallback.items.length) {
      return {
        items: sortIndices(fallback.items),
        meta: buildMeta({
          source: "public-vn",
          sourceTimestampMs: fallback.sourceTs ?? Date.now(),
          note: "Fallback public indices",
        }),
      };
    }
  } catch {
    /* unavailable */
  }
  return null;
}

export async function getVnQuotes(symbols: string[]): Promise<{ quotes: Quote[]; meta: Meta } | null> {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
  if (!uniq.length) return { quotes: [], meta: buildMeta({ source: "vndirect" }) };
  bootVndLive();
  for (const s of uniq) {
    if (!isRealtimeWsDisabled("VNDIRECT_WS_DISABLED")) vndirectWs.watchSymbol(s);
    if (ssiFcConfigured() && !isRealtimeWsDisabled("SSI_WS_DISABLED")) ssiWs.watchSymbol(s);
  }
  try {
    const multi = await getMultiQuotes(uniq);
    if (multi.quotes.length) {
      return {
        quotes: multi.quotes,
        meta: buildMeta({
          source: multi.sources[0] ?? "multi",
          sourceTimestampMs: multi.sourceTs ?? Date.now(),
        }),
      };
    }
  } catch {
    /* */
  }
  try {
    const r = await vndirect.getVndQuotes(uniq);
    if (r.quotes?.length) {
      return {
        quotes: r.quotes,
        meta: buildMeta({ source: "vndirect", sourceTimestampMs: r.sourceTs ?? Date.now() }),
      };
    }
  } catch {
    /* */
  }
  return null;
}

export async function getVnOhlcv(
  symbol: string,
  limit = 250,
): Promise<{ bars: OhlcvBar[]; meta: Meta } | null> {
  const sym = symbol.toUpperCase();
  bootVndLive();
  bootSsiLive();
  const isIndex = vndirect.isVnIndexSymbol(sym);
  if (ssiFcConfigured() && !isIndex && !isRealtimeWsDisabled("SSI_WS_DISABLED")) ssiWs.watchSymbol(sym);
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
      producer: async () => {
        try {
          const { fetchVndDchartHistory } = await import("../providers/vndirect-dchart");
          const bars = await Promise.race([
            fetchVndDchartHistory(sym, "D", limit),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error("dchart_budget")), 6_500)),
          ]);
          if (bars?.length) return bars;
        } catch {
          /* */
        }
        try {
          if (isIndex) {
            const idx = await vndirect.getVndIndexOhlcv(sym, limit);
            if (idx?.length) return idx;
          } else {
            const stockBars = await vndirect.getVndOhlcv(sym, limit);
            if (stockBars?.length) return stockBars;
          }
        } catch {
          /* */
        }
        const pub = await getPublicOhlcv(sym, limit, isIndex ? "index" : "stock");
        if (pub?.length) return pub;
        throw new Error(`ohlcv empty ${sym}`);
      },
    });
    return {
      bars: res.value,
      meta: buildMeta({
        source: "vndirect-dchart",
        sourceTimestampMs: Date.now(),
        cached: res.cached,
        stale: res.stale,
      }),
    };
  } catch (e) {
    console.warn("[getVnOhlcv] primary", e);
  }
  try {
    const bars = await getPublicOhlcv(sym, limit, isIndex ? "index" : "stock");
    if (bars.length) {
      return {
        bars,
        meta: buildMeta({
          source: "entrade-public",
          sourceTimestampMs: Date.now(),
          note: "Fallback Entrade public OHLCV",
        }),
      };
    }
  } catch {
    /* */
  }
  return null;
}

export async function getVnMarketBoard(): Promise<{
  quotes: Quote[];
  indices: IndexQuote[];
  universeSize: number;
  sessionDate: string;
  meta: Meta;
} | null> {
  bootVndLive();
  bootSsiLive();
  try {
    const mq = await vndirect.getVndMarketQuotes();
    if (!mq.quotes?.length) return null;
    const idx = await vndirect
      .getVndIndices()
      .catch(() => ({ items: [] as IndexQuote[], sourceTs: null as number | null }));
    return {
      quotes: mq.quotes,
      indices: sortIndices(idx.items),
      universeSize: mq.quotes.length,
      sessionDate: mq.sessionDate,
      meta: buildMeta({ source: "vndirect", sourceTimestampMs: mq.sourceTs ?? Date.now() }),
    };
  } catch {
    return null;
  }
}

export async function getVnUniverseList(): Promise<{
  items: { symbol: string; name?: string | null; floor?: string | null }[];
  meta: Meta;
} | null> {
  try {
    const items = await vndirect.getVndUniverse();
    return { items, meta: buildMeta({ source: "vndirect" }) };
  } catch {
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
  equity: VndEquitySnapshot | null;
  sharesOutstanding: number | null;
  profile: Pick<
    VndCompanyProfile,
    "vnName" | "enName" | "floor" | "logo" | "employees" | "website"
  > | null;
  orderBook: VnOrderBook | null;
  foreignFlow: { latest: unknown; history: unknown[] } | null;
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
  /** Detailed ratios from multi-source quote + BCTC (ratio-engine) */
  detailedRatios: import("../financial/ratio-engine").RatioEngineResult | null;
  ratioMap: Record<string, number | null>;
  metricsSources: string[];
  notes: string[];
}

async function withBudget<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p.then((v) => v).catch(() => null as T | null),
    new Promise<null>((r) => setTimeout(() => r(null), ms)),
  ]);
}

/** Build one stock detail pack — all sources in one parallel wave + short budgets. */
async function produceVnStockDetail(
  sym: string,
): Promise<{ detail: VnStockDetail; meta: Meta } | null> {
  bootVndLive();
  bootSsiLive();
  if (!isRealtimeWsDisabled("SSI_WS_DISABLED")) ssiWs.watchSymbol(sym);
  if (!isRealtimeWsDisabled("VNDIRECT_WS_DISABLED")) vndirectWs.watchSymbol(sym);
  const failed: string[] = [];
  const notes: string[] = [];

  const [quoteRes, ohlcvRes, profileRes, equityRes, bookRes, foreignRes, finRes, metricsRes] =
    await Promise.all([
      getVnQuotes([sym]).catch(() => null),
      getVnOhlcv(sym, 180).catch(() => null),
      withBudget(getVndCompanyProfile(sym), 3_200),
      withBudget(getVndEquitySnapshot(sym), 3_200),
      withBudget(getVnOrderBook(sym), 2_800),
      withBudget(getVndSymbolForeignFlow(sym, 12), 3_200),
      withBudget(getFinancialsForSymbol(sym), 6_000),
      withBudget(
        import("./stock-metrics-service").then((m) => m.getStockMetricsBundle(sym)),
        8_000,
      ),
    ]);

  let quote: Quote | null = quoteRes?.quotes?.[0] ?? null;
  if (!quote) failed.push("quote");
  const bars = ohlcvRes?.bars ?? [];
  if (!bars.length) failed.push("ohlcv");

  const profile = profileRes
    ? {
        vnName: profileRes.vnName,
        enName: profileRes.enName,
        floor: profileRes.floor,
        logo: profileRes.logo,
        employees: profileRes.employees,
        website: profileRes.website,
      }
    : null;
  const name = profile?.vnName ?? profile?.enName ?? quote?.name ?? null;
  if (quote && name && !quote.name) quote = { ...quote, name };

  const equity = equityRes;
  const sharesOutstanding = equity?.sharesOutstanding ?? null;
  if (!sharesOutstanding) notes.push("Chưa có số CP lưu hành từ ratios");

  const orderBook = bookRes?.book ?? null;
  if (!orderBook) notes.push("Sổ lệnh: cần SSI depth / phiên giao dịch");

  const foreignFlow = foreignRes ? { latest: foreignRes.latest, history: foreignRes.history } : null;
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

  const fin = finRes;
  if (!fin) failed.push("financials");
  if (metricsRes?.bundle?.qualityScore != null) {
    notes.push(`Chỉ số TC: quality ${metricsRes.bundle.qualityScore}/100`);
  }
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
    detailedRatios: metricsRes?.bundle?.ratios ?? null,
    ratioMap: metricsRes?.bundle?.ratioMap ?? {},
    metricsSources: [
      ...(metricsRes?.bundle?.sources?.quote ?? []),
      metricsRes?.bundle?.sources?.financials,
      metricsRes?.bundle?.sources?.marketRatios,
    ].filter(Boolean) as string[],
    notes,
  };

  return {
    detail,
    meta: buildMeta({
      source:
        [quoteRes?.meta?.source, ohlcvRes?.meta?.source, ...(detail.metricsSources ?? [])]
          .filter(Boolean)
          .join("+") || "vndirect",
      sourceTimestampMs: Date.now(),
      note: notes.length ? notes.join(" · ") : undefined,
      partial: failed.length > 0,
    }),
  };
}

/**
 * Stock detail — soft SWR so layout + page share one flight.
 * Fresh 12s (trading) / 25s · stale up to 90s.
 */
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
  } catch {
    /* */
  }
  try {
    const res = await cached<{ detail: VnStockDetail; meta: Meta } | null>(`vn:stock-detail:${sym}:v3`, {
      ttlMs: ttl,
      staleMs: stale,
      softSwr: true,
      producer: () => produceVnStockDetail(sym),
    });
    if (!res.value) return null;
    return {
      detail: res.value.detail,
      meta: {
        ...res.value.meta,
        cached: res.cached,
        stale: res.stale,
        note: res.cached
          ? `${res.value.meta.note ?? ""} · cache${res.stale ? " stale" : ""}`.trim()
          : res.value.meta.note,
      },
    };
  } catch {
    return produceVnStockDetail(sym);
  }
}

export { getVnOrderBook, type VnOrderBook } from "./stock-orderbook";
export { vnProviderLayout };
