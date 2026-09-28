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
  type IdxPack = {
    items: IndexQuote[];
    source: string;
    sourceTs: number | null;
    note?: string;
    partial?: boolean;
  };
  const { raceSources, mergeIndexQuotes } = await import("../resilience/source-race");

  const settled = await raceSources<IdxPack | null>(
    [
      {
        id: "vndirect",
        timeoutMs: 7_000,
        run: async () => {
          const r = await vndirect.getVndIndices();
          if (!r.items?.length) return null;
          return { items: r.items, source: "vndirect", sourceTs: r.sourceTs ?? Date.now() };
        },
      },
      {
        id: "ssi-fcdata",
        timeoutMs: 6_000,
        run: async () => {
          if (!ssiFcConfigured()) return null;
          const ssi = await getSsiIndices();
          if (!ssi.items?.length) return null;
          return { items: ssi.items, source: "ssi-fcdata", sourceTs: ssi.sourceTs ?? Date.now() };
        },
      },
      {
        id: "yahoo-public",
        circuit: "yahoo-fx",
        timeoutMs: 8_000,
        run: async () => {
          const pub = await getPublicIndices(["VNINDEX", "VN30", "HNX", "UPCOM"]);
          if (!pub.items?.length) return null;
          return {
            items: pub.items,
            source: "yahoo-public",
            sourceTs: pub.sourceTs ?? Date.now(),
            note: "Public indices (Yahoo/VPS) — có thể trễ ngoài phiên",
            partial: true,
          };
        },
      },
    ],
    {
      hardStopMs: 9_000,
      isEnough: (v) => Boolean(v && v.source === "vndirect" && (v.items?.length ?? 0) >= 3),
    },
  );

  const packs = settled
    .filter((s) => s.ok && s.value?.items?.length)
    .map((s) => s.value!) as IdxPack[];
  if (!packs.length) return null;

  const priority = ["vndirect", "ssi-fcdata", "yahoo-public"];
  const merged = mergeIndexQuotes(
    packs.map((p) => ({ source: p.source, items: p.items })),
    priority,
  );
  if (!merged.length) return null;

  const primary = packs.sort(
    (a, b) => priority.indexOf(a.source) - priority.indexOf(b.source),
  )[0];
  const sourcesUsed = [...new Set(packs.map((p) => p.source))];
  return {
    items: sortIndices(merged),
    meta: buildMeta({
      source: sourcesUsed.length > 1 ? sourcesUsed.join("+") : primary.source,
      sourceTimestampMs: Math.max(...packs.map((p) => p.sourceTs ?? 0), Date.now()),
      note:
        sourcesUsed.length > 1
          ? `Merge chỉ số: ${sourcesUsed.join(" > ")}`
          : primary.note,
      partial: sourcesUsed.includes("yahoo-public") && !sourcesUsed.includes("vndirect"),
    }),
  };
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
    const multi = await getMultiQuotes(uniq);
    if (multi.quotes.length) {
      const latNote = Object.entries(multi.latencies)
        .map(([k, v]) => `${k}:${v}ms`)
        .join(" ");
      return {
        quotes: multi.quotes,
        meta: buildMeta({
          source: multi.sources[0] ?? "multi",
          sourceTimestampMs: multi.sourceTs ?? Date.now(),
          note: [
            multi.sources.length > 1 ? `priority:${multi.sources.join(">")}` : undefined,
            multi.conflicts ? `conflicts:${multi.conflicts}` : undefined,
            latNote || undefined,
          ]
            .filter(Boolean)
            .join(" | ") || undefined,
        }),
      };
    }
  } catch (e) {
    console.warn("[getVnQuotes multi]", e);
  }
  try {
    const r = await vndirect.getVndQuotes(uniq);
    if (r.quotes?.length) {
      return {
        quotes: r.quotes,
        meta: buildMeta({ source: "vndirect", sourceTimestampMs: r.sourceTs ?? Date.now() }),
      };
    }
  } catch (e) {
    console.warn("[getVnQuotes] vndirect", e);
  }
  if (ssiFcConfigured()) {
    try {
      const ssi = await getSsiQuotes(uniq);
      if (ssi.quotes?.length) {
        return {
          quotes: ssi.quotes,
          meta: buildMeta({ source: "ssi-fcdata", sourceTimestampMs: ssi.sourceTs ?? undefined }),
        };
      }
    } catch (e) {
      console.warn("[getVnQuotes] ssi", e);
    }
  }
  try {
    const pub = await getPublicQuotes(uniq);
    if (pub.quotes.length) {
      return {
        quotes: pub.quotes,
        meta: buildMeta({
          source: `public-vn(${(pub as { sources?: string[] }).sources?.length ? (pub as { sources?: string[] }).sources!.join("+") : "vps+ssi-iboard"})`,
          sourceTimestampMs: pub.sourceTs ?? Date.now(),
          note: "Fallback public race VPS ∥ SSI iBoard (no key)",
          partial: pub.quotes.length < uniq.length,
        }),
      };
    }
  } catch (e) {
    console.warn("[getVnQuotes] public-vn", e);
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
  if (ssiFcConfigured() && !isIndex) ssiWs.watchSymbol(sym);
  try {
    const { getVnSession } = await import("../vn/sessions");
    let ohlcvTtl = 6_000;
    let ohlcvStale = 60_000;
    try {
      const sess = getVnSession();
      if (sess.trading) {
        ohlcvTtl = 3_000;
        ohlcvStale = 30_000;
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
          const bars = await fetchVndDchartHistory(sym, "D", limit);
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
  } catch (e2) {
    console.warn("[getVnOhlcv] entrade", e2);
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
  const { raceSources } = await import("../resilience/source-race");
  type BoardPack = {
    quotes: Quote[];
    indices: IndexQuote[];
    universeSize: number;
    sessionDate: string;
    source: string;
    sourceTs: number;
    note?: string;
    partial?: boolean;
  };
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });

  const settled = await raceSources<BoardPack | null>(
    [
      {
        id: "vndirect",
        timeoutMs: 10_000,
        run: async () => {
          const [mq, idx] = await Promise.all([
            vndirect.getVndMarketQuotes(),
            vndirect.getVndIndices().catch(() => ({
              items: [] as IndexQuote[],
              sourceTs: null as number | null,
            })),
          ]);
          if (!mq.quotes?.length) return null;
          return {
            quotes: mq.quotes,
            indices: sortIndices(idx.items),
            universeSize: mq.quotes.length,
            sessionDate: mq.sessionDate,
            source: "vndirect",
            sourceTs: mq.sourceTs ?? Date.now(),
          };
        },
      },
      {
        id: "multi-quote",
        timeoutMs: 8_000,
        run: async () => {
          const multi = await getMultiQuotes(LIQUID_BOARD.slice(0, 100));
          if (multi.quotes.length < 15) return null;
          const idx = await getVnIndices().catch(() => null);
          return {
            quotes: multi.quotes,
            indices: idx?.items ? sortIndices(idx.items) : [],
            universeSize: multi.quotes.length,
            sessionDate: today,
            source: multi.sources.join("+") || "multi-quote",
            sourceTs: multi.sourceTs ?? Date.now(),
            note: `Rổ thanh khoản ${multi.quotes.length} mã · ${multi.sources.join(">")}`,
            partial: true,
          };
        },
      },
      {
        id: "public-vn",
        timeoutMs: 8_000,
        run: async () => {
          const [pubQ, pubI] = await Promise.all([
            getPublicQuotes(LIQUID_BOARD),
            getPublicIndices(["VNINDEX", "VN30", "HNX", "UPCOM"]).catch(() => ({
              items: [] as IndexQuote[],
              sourceTs: null as number | null,
            })),
          ]);
          if (!pubQ.quotes.length) return null;
          return {
            quotes: pubQ.quotes,
            indices: sortIndices(pubI.items),
            universeSize: pubQ.quotes.length,
            sessionDate: today,
            source: "vps+ssi-iboard+yahoo",
            sourceTs: pubQ.sourceTs ?? Date.now(),
            note: "Fallback public board — không full HOSE",
            partial: true,
          };
        },
      },
    ],
    {
      hardStopMs: 11_000,
      isEnough: (v) => Boolean(v && v.source === "vndirect" && v.quotes.length >= 50),
    },
  );

  const priority = ["vndirect", "multi-quote", "public-vn"];
  const ok = settled.filter((s) => s.ok && s.value && s.value.quotes.length > 0);
  if (!ok.length) return null;
  ok.sort((a, b) => {
    const pa = priority.indexOf(a.id);
    const pb = priority.indexOf(b.id);
    if (pa !== pb) return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb);
    return (b.value?.quotes.length ?? 0) - (a.value?.quotes.length ?? 0);
  });
  const best = ok[0].value!;
  return {
    quotes: best.quotes,
    indices: best.indices,
    universeSize: best.universeSize,
    sessionDate: best.sessionDate,
    meta: buildMeta({
      source: best.source,
      sourceTimestampMs: best.sourceTs,
      note: best.note,
      partial: best.partial,
    }),
  };
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
