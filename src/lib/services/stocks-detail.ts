import "server-only";
import { buildMeta } from "../freshness";
import { getFinancialsForSymbol } from "../financial";
import type { FinancialPackageMeta, GrowthSnapshot, NormalizedPeriod } from "../financial/types";
import type { FinancialHealthResult } from "../engines/fundamental";
import * as vndirect from "../providers/vndirect";
import { analyzeSeries, detectPatterns } from "../technical";
import { computeAlphaBeta } from "../engines/alpha-beta";
import type { CandlePattern, Meta, OhlcvBar, Quote, TechnicalSnapshot } from "../types";
import {
  getVndCompanyProfile,
  getVndEquitySnapshot,
  getVndValuationRatios,
  type VndCompanyProfile,
  type VndEquitySnapshot,
  type VndValuationRatios,
} from "../providers/vndirect-company";
import { lookupVndSymbol } from "../providers/vndirect-universe";
import { getVndSymbolForeignFlow } from "../providers/vndirect-foreign-symbol";
import { getVietcapCompany } from "../providers/vietcap";
import { getVpsQuotes } from "../providers/vps";
import { getVnOrderBook, type VnOrderBook } from "./stock-orderbook";
import { getVnQuotes, getVnOhlcv } from "./stocks-board";
import { fetchOhlcvResilient } from "./screener-ohlcv";
import { cached } from "../cache";
import { WORKERS_BUDGET } from "../data-engine/workers-budget";

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
  financials: {
    income?: Record<string, unknown>[] | null;
    balance?: Record<string, unknown>[] | null;
    cashflow?: Record<string, unknown>[] | null;
    [key: string]: unknown;
  } | null;
  financialHealth: FinancialHealthResult | null;
  financialMeta: FinancialPackageMeta | null;
  financialGrowth: GrowthSnapshot | null;
  financialTtm: NormalizedPeriod | null;
  detailedRatios: {
    marketCap?: number | null;
    flat?: { key: string; value: number | null; [k: string]: unknown }[] | null;
    [key: string]: unknown;
  } | null;
  ratioMap: Record<string, unknown>;
  metricsSources: string[];
  notes: string[];
}

/** Soft-timeout: never let one slow source hang the whole detail page. */
async function soft<T>(p: Promise<T>, ms: number, _label?: string): Promise<T | null> {
  try {
    return await Promise.race([
      p.then((v) => v).catch(() => null as T | null),
      new Promise<null>((r) => setTimeout(() => r(null), ms)),
    ]);
  } catch {
    return null;
  }
}

/**
 * Produce stock detail under Workers resource budget (avoids Error 1102).
 * Stage A (≤4 parallel): quote + OHLCV + profile + equity
 * Stage B (≤3 parallel): ratios + orderbook + foreign — only if wall remains
 * Stage C (sequential): financials — only if wall remains
 * Dual OHLCV race is deferred (legacy first, resilient only on miss).
 */
async function produceVnStockDetail(sym: string): Promise<{ detail: VnStockDetail; meta: Meta } | null> {
  const failed: string[] = [];
  const notes: string[] = [];
  const wallStart = Date.now();
  const wallLeft = () => WORKERS_BUDGET.detailWallMs - (Date.now() - wallStart);
  const BARS = WORKERS_BUDGET.detailBars;
  const softMs = WORKERS_BUDGET.providerSoftMs;

  // Stage A — core (max 4 parallel)
  const [quoteRes, ohlcvLegacy, profileRes, equityRes] = await Promise.all([
    soft(getVnQuotes([sym]), softMs, "quotes"),
    soft(getVnOhlcv(sym, BARS), Math.min(7_000, softMs + 2_000), "ohlcv"),
    soft(getVndCompanyProfile(sym), softMs, "profile"),
    soft(getVndEquitySnapshot(sym), softMs, "equity"),
  ]);

  // OHLCV resilient only if legacy empty and budget remains
  let ohlcvResilient: Awaited<ReturnType<typeof fetchOhlcvResilient>> | null = null;
  if (!(ohlcvLegacy?.bars?.length) && wallLeft() > 4_000) {
    ohlcvResilient = await soft(fetchOhlcvResilient(sym, BARS), 6_000, "ohlcv-resilient");
  }

  // Stage B — secondary
  let bookRes: Awaited<ReturnType<typeof getVnOrderBook>> | null = null;
  let foreignRes: Awaited<ReturnType<typeof getVndSymbolForeignFlow>> | null = null;
  let valRatioRes: Awaited<ReturnType<typeof getVndValuationRatios>> | null = null;
  if (wallLeft() > 3_000) {
    const secondary = await Promise.all([
      soft(getVnOrderBook(sym), 3_500, "orderbook"),
      soft(getVndSymbolForeignFlow(sym), 3_500, "foreign"),
      soft(getVndValuationRatios(sym), softMs, "ratios"),
    ]);
    bookRes = secondary[0];
    foreignRes = secondary[1];
    valRatioRes = secondary[2];
  } else {
    notes.push("skip:secondary-budget");
  }

  // Stage C — financials (heaviest)
  let finRes: Awaited<ReturnType<typeof getFinancialsForSymbol>> | null = null;
  if (wallLeft() > 5_000) {
    finRes = await soft(
      getFinancialsForSymbol(sym),
      Math.min(WORKERS_BUDGET.financialSoftMs, Math.max(2_000, wallLeft() - 500)),
      "financials",
    );
  } else {
    notes.push("skip:financials-budget");
  }

  let quote = quoteRes?.quotes?.[0] ?? null;
  if (!quote) {
    const vps = await getVpsQuotes([sym]).catch(() => []);
    if (vps[0]) quote = vps[0];
  }

  let profile = profileRes ?? null;
  let equity = equityRes ?? null;

  if (!profile) {
    try {
      const u = await lookupVndSymbol(sym);
      if (u) {
        profile = {
          code: sym,
          floor: u.exchange,
          logo: `https://www.vndirect.com.vn/vndirect-resource/nextcom/attachment/LOGO/${sym}.jpg`,
          vnName: u.name,
          enName: null,
          foundDate: null,
          taxCode: null,
          registrationCode: null,
          vnAddress: null,
          enAddress: null,
          phone: null,
          fax: null,
          website: null,
          email: null,
          employees: null,
          branches: null,
          vnSummary: null,
          enSummary: null,
        };
      }
    } catch {
      /* ignore */
    }
  }

  if (!quote || !profile || !equity) {
    try {
      const vietcapData = await getVietcapCompany(sym).catch(() => null);
      if (vietcapData) {
        if (!quote && vietcapData.price) {
          const p = vietcapData.price >= 1000 ? vietcapData.price / 1000 : vietcapData.price;
          quote = {
            symbol: sym,
            assetClass: "stock",
            price: p,
            name: vietcapData.name,
            change: null,
            changePercent: null,
            volume: null,
            quoteVolume: null,
            high: null,
            low: null,
            open: null,
            referencePrice: null,
            ceilingPrice: null,
            floorPrice: null,
            updatedAt: new Date().toISOString(),
          };
        }
        if (!profile) {
          profile = {
            code: sym,
            floor: vietcapData.exchange,
            logo: null,
            vnName: vietcapData.name,
            enName: vietcapData.nameEn,
            foundDate: vietcapData.listedDate,
            taxCode: null,
            registrationCode: null,
            vnAddress: null,
            enAddress: null,
            phone: null,
            fax: null,
            website: null,
            email: null,
            employees: null,
            branches: null,
            vnSummary: vietcapData.sector ? `Ngành: ${vietcapData.sector}` : null,
            enSummary: vietcapData.sector ? `Sector: ${vietcapData.sector}` : null,
          };
        }
        if (!equity && (vietcapData.sharesOutstanding || vietcapData.marketCap)) {
          equity = {
            sharesOutstanding: vietcapData.sharesOutstanding,
            totalShares: vietcapData.sharesOutstanding,
            marketCapReported: vietcapData.marketCap,
            reportDate: null,
            source: "vietcap",
          };
        }
      }
    } catch {
      /* ignore */
    }
  }

  if (!quote) failed.push("quote");
  const name = quote?.name ?? (profile as { vnName?: string } | null)?.vnName ?? null;
  const bars =
    (ohlcvResilient?.bars?.length ? ohlcvResilient.bars : null) ??
    ohlcvLegacy?.bars ??
    [];
  if (ohlcvResilient?.bars?.length) notes.push(`ohlcv:${ohlcvResilient.pack?.meta?.source ?? "resilient"}`);
  else if (ohlcvLegacy?.bars?.length) notes.push(`ohlcv:${ohlcvLegacy.meta?.source ?? "legacy"}`);
  if (!bars.length) failed.push("ohlcv");

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

  // Alpha-beta optional — skip under tight budget (extra VNINDEX fetch).
  let alphaBeta: unknown = null;
  if (bars.length >= 60 && wallLeft() > 4_000) {
    try {
      const idx = await soft(getVnOhlcv("VNINDEX", BARS), 4_000, "vnindex");
      if (idx?.bars?.length) {
        alphaBeta = computeAlphaBeta(bars, idx.bars);
      }
    } catch {
      /* */
    }
  }

  const orderBook = bookRes?.book ?? null;
  const foreignFlow = foreignRes
    ? { latest: foreignRes.latest ?? null, history: foreignRes.history ?? null }
    : null;

  const financials = finRes?.financials ?? null;
  const financialHealth = finRes?.health ?? null;
  const financialMeta = finRes?.packageMeta ?? null;
  const financialGrowth = finRes?.growth ?? null;
  const financialTtm = finRes?.ttm ?? null;

  const ratioMap: Record<string, unknown> = {};
  if (valRatioRes) {
    if (valRatioRes.pe != null) ratioMap.pe = valRatioRes.pe;
    if (valRatioRes.pb != null) ratioMap.pb = valRatioRes.pb;
    if (valRatioRes.ps != null) ratioMap.ps = valRatioRes.ps;
    if (valRatioRes.evEbitda != null) ratioMap.evEbitda = valRatioRes.evEbitda;
    if (valRatioRes.eps != null) ratioMap.eps = valRatioRes.eps;
    if (valRatioRes.bvps != null) ratioMap.bvps = valRatioRes.bvps;
    if (valRatioRes.roe != null) ratioMap.roe = valRatioRes.roe;
    if (valRatioRes.roa != null) ratioMap.roa = valRatioRes.roa;
    if (valRatioRes.dividendYield != null) ratioMap.dividendYield = valRatioRes.dividendYield;
    if (valRatioRes.marketCap != null) ratioMap.marketCap = valRatioRes.marketCap;
  }

  const detailedRatios = valRatioRes
    ? {
        marketCap: valRatioRes.marketCap ?? equity?.marketCapReported ?? null,
        flat: Object.entries(ratioMap).map(([key, value]) => ({
          key,
          value: typeof value === "number" ? value : null,
        })),
        ...ratioMap,
      }
    : null;

  const sources = [
    quoteRes?.meta?.source,
    ohlcvResilient?.pack?.meta?.source ?? ohlcvLegacy?.meta?.source,
    finRes?.meta?.source,
    valRatioRes?.source,
  ].filter(Boolean) as string[];

  if (failed.length) notes.push(`missing: ${failed.join(",")}`);
  if (alphaBeta) notes.push("alpha-beta ok");

  const detail: VnStockDetail = {
    symbol: sym,
    name,
    quote,
    bars,
    technical,
    patterns,
    equity,
    sharesOutstanding: equity?.sharesOutstanding ?? equity?.totalShares ?? null,
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
    metricsSources: sources,
    notes,
  };

  const meta = buildMeta({
    source: sources.join("+") || "vn-stock-detail",
    sourceTimestampMs: Date.now(),
    partial: failed.length > 0,
    note: notes.join(" · ") || undefined,
  });

  return { detail, meta };
}

function emptyShell(sym: string, note: string): { detail: VnStockDetail; meta: Meta } {
  return {
    detail: {
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
      financials: null,
      financialHealth: null,
      financialMeta: null,
      financialGrowth: null,
      financialTtm: null,
      detailedRatios: null,
      ratioMap: {},
      metricsSources: [],
      notes: [note],
    },
    meta: buildMeta({
      source: "degraded",
      sourceTimestampMs: Date.now(),
      note,
      partial: true,
    }),
  };
}

export async function getVnStockDetail(
  symbol: string,
): Promise<{ detail: VnStockDetail; meta: Meta } | null> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return null;

  try {
    const hit = await cached(`vn:stock-detail:${sym}:v2`, {
      ttlMs: 25_000,
      staleMs: 180_000,
      softSwr: true,
      producer: async () => {
        // Single produce — no double-retry (avoids 2× subrequest burn on Workers).
        const r = await produceVnStockDetail(sym);
        if (!r) throw new Error(`detail unavailable: ${sym}`);
        return r;
      },
    });
    return hit.value;
  } catch (e) {
    return emptyShell(sym, e instanceof Error ? e.message : "detail_error");
  }
}
