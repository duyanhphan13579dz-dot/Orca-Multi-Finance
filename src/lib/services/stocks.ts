import "server-only";
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

function bootVndLive() {
  if (process.env.VNDIRECT_WS_DISABLED === "true") return;
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
  return vnMarketConfigured();
}

export function vnPrimaryProvider(): "ssi-fcdata" | "vndirect" {
  return "vndirect";
}

export async function getVnIndices(): Promise<{ items: IndexQuote[]; meta: Meta } | null> {
  bootVndLive();
  try {
    const r = await vndirect.getVndIndices();
    return {
      items: sortIndices(r.items),
      meta: buildMeta({ source: "vndirect", sourceTimestampMs: r.sourceTs ?? Date.now() }),
    };
  } catch (e) {
    if (ssiFcConfigured()) {
      try {
        const items = await getSsiIndices();
        return { items: sortIndices(items), meta: buildMeta({ source: "ssi-fcdata" }) };
      } catch {
        /* */
      }
    }
    console.warn("[getVnIndices]", e);
    return null;
  }
}

export async function getVnQuotes(symbols: string[]): Promise<{ quotes: Quote[]; meta: Meta } | null> {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
  if (!uniq.length) return { quotes: [], meta: buildMeta({ source: "vndirect" }) };
  bootVndLive();
  for (const s of uniq) {
    if (process.env.VNDIRECT_WS_DISABLED !== "true") vndirectWs.watchSymbol(s);
    if (ssiFcConfigured()) ssiWs.watchSymbol(s);
  }
  try {
    const r = await vndirect.getVndQuotes(uniq);
    return {
      quotes: r.quotes,
      meta: buildMeta({ source: "vndirect", sourceTimestampMs: r.sourceTs ?? Date.now() }),
    };
  } catch (e) {
    if (ssiFcConfigured()) {
      try {
        const quotes = await getSsiQuotes(uniq);
        return { quotes, meta: buildMeta({ source: "ssi-fcdata" }) };
      } catch {
        /* */
      }
    }
    console.warn("[getVnQuotes]", e);
    return null;
  }
}

export async function getVnOhlcv(
  symbol: string,
  limit = 250,
): Promise<{ bars: OhlcvBar[]; meta: Meta } | null> {
  const sym = symbol.toUpperCase();
  bootVndLive();
  bootSsiLive();
  const isIndex = vndirect.isVnIndexSymbol(sym);
  if (ssiFcConfigured() && !isIndex) ssiWs.watchSymbol(sym);
  try {
    const res = await cached(`vn:ohlcv:vnd:${sym}:${limit}`, {
      ttlMs: 6_000,
      staleMs: 60_000,
      producer: async () => {
        try {
          const { fetchVndDchartHistory } = await import("../providers/vndirect-dchart");
          const bars = await fetchVndDchartHistory(sym, "1D", limit);
          if (bars?.length) return bars;
        } catch {
          /* fall through */
        }
        if (isIndex) return vndirect.getVndIndexOhlcv(sym, limit);
        return vndirect.getVndOhlcv(sym, limit);
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
    console.warn("[getVnOhlcv]", e);
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
  bootVndLive();
  bootSsiLive();
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
      meta: buildMeta({
        source: "vndirect",
        sourceTimestampMs: mq.sourceTs ?? Date.now(),
      }),
    };
  } catch (e) {
    console.warn("[getVnMarketBoard]", e);
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
  } catch (e) {
    console.warn("[getVnUniverseList]", e);
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
  foreignFlow: {
    latest: {
      tradingDate: string;
      buyVal: number;
      sellVal: number;
      netVal: number;
      buyVol: number;
      sellVol: number;
      netVol: number;
      totalRoom: number | null;
      currentRoom: number | null;
      floor: string | null;
    } | null;
    history: {
      tradingDate: string;
      buyVal: number;
      sellVal: number;
      netVal: number;
      buyVol: number;
      sellVol: number;
      netVol: number;
      totalRoom: number | null;
      currentRoom: number | null;
      floor: string | null;
    }[];
  } | null;
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
  bootVndLive();
  bootSsiLive();
  ssiWs.watchSymbol(sym);
  if (process.env.VNDIRECT_WS_DISABLED !== "true") vndirectWs.watchSymbol(sym);
  const failed: string[] = [];
  const notes: string[] = [];

  const [quoteRes, ohlcvRes, profileRes, equityRes, bookRes, foreignRes, finRes] =
    await Promise.all([
      getVnQuotes([sym]).catch(() => null),
      getVnOhlcv(sym, 250).catch(() => null),
      getVndCompanyProfile(sym).catch(() => null),
      getVndEquitySnapshot(sym).catch(() => null),
      getVnOrderBook(sym).catch(() => null),
      getVndSymbolForeignFlow(sym, 20).catch(() => null),
      getFinancialsForSymbol(sym).catch(() => null),
    ]);

  let quote: Quote | null = quoteRes?.quotes?.[0] ?? null;
  const quoteSource = quoteRes?.meta?.source ?? "";
  if (!quote) failed.push("quote");

  const bars = ohlcvRes?.bars ?? [];
  const ohlcvSource = ohlcvRes?.meta?.source ?? "";
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
  if (quote && name && !quote.name) {
    quote = { ...quote, name };
  }

  const equity = equityRes;
  const sharesOutstanding = equity?.sharesOutstanding ?? null;
  if (!sharesOutstanding) notes.push("Chưa có số CP lưu hành từ ratios");

  const orderBook = bookRes?.book ?? null;
  if (!orderBook) notes.push("Sổ lệnh: cần SSI depth / phiên giao dịch");

  const foreignFlow = foreignRes
    ? { latest: foreignRes.latest, history: foreignRes.history }
    : null;
  if (!foreignFlow?.latest) failed.push("foreign");

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

  const fin = finRes;
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
    financials: fin?.financials ?? {
      income: null,
      balance: null,
      cashflow: null,
      ratios: null,
    },
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
        [
          quoteSource,
          ohlcvSource,
          profile ? "vndirect-profile" : null,
          equity ? equity.source : null,
          foreignFlow?.latest ? "vndirect-foreigns" : null,
          orderBook ? "ssi-orderbook" : null,
          fin?.packageMeta?.primarySource,
        ]
          .filter(Boolean)
          .join("+") || "vndirect",
      sourceTimestampMs: Date.now(),
      degraded: failed.length > 0,
      partial: failed.length > 0,
      note: notes[0],
    }),
  };
}

export { getVnOrderBook, type VnOrderBook } from "./stock-orderbook";
export { vnProviderLayout };
