/**
 * Pipeline phân tích cơ bản + định giá — ĐỘC LẬP với trang Báo cáo tài chính.
 *
 * Kết hợp:
 *  - Giá realtime (multi-source getVnQuotes)
 *  - CP lưu hành + MARKETCAP ratios VNDirect
 *  - PE/PB/PS/EPS/BVPS từ VNDirect ratios (chuẩn DStock)
 *  - BCTC kéo thẳng api-finfo → health anchors → engine định giá
 *  - DCF 2 giai đoạn chi tiết (Bear/Base/Bull + sensitivity)
 *
 * Lưu ý đơn vị: giá quote HOSE thường là nghìn đồng; BCTC/MARKETCAP là VND.
 */
import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { computeFinancialHealth, type FinancialHealthResult } from "../engines/fundamental";
import { computeValuation } from "../engines/valuation";
import { collectPeerMetrics } from "../engines/valuation-peers";
import { fetchVndirectFinancials, periodsToLegacyRows } from "../financial/vndirect-fs";
import {
  getVndEquitySnapshot,
  getVndValuationRatios,
  priceQuoteToVnd,
} from "../providers/vndirect-company";
import { ensureVndirectWsStarted, vndirectWs } from "../realtime/vndirect-ws";
import { getVnQuotes } from "./stocks";
import { sectorOf } from "../vn/master";
import type { Meta } from "../types";

export interface FundamentalValuationResult {
  symbol: string;
  data: Record<string, unknown>;
  meta: Meta;
  health: FinancialHealthResult;
}

function saneMultiple(v: number | null | undefined, maxAbs = 500): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  if (v <= 0) return null;
  if (Math.abs(v) > maxAbs) return null;
  return v;
}

function saneYieldPct(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  if (Math.abs(v) > 80) return null;
  return v;
}

export async function runFundamentalValuation(
  symbolRaw: string,
  opts?: { peers?: boolean; full?: boolean },
): Promise<FundamentalValuationResult | null> {
  const symbol = symbolRaw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!symbol || symbol.length < 3 || symbol.length > 12) return null;

  const wantPeers = opts?.peers !== false;
  const wantFull = opts?.full === true;

  try {
    if (process.env.VNDIRECT_WS_DISABLED !== "true") {
      ensureVndirectWsStarted();
      vndirectWs.watchSymbol(symbol);
    }
  } catch {
    /* serverless */
  }

  const fsP = cached(`fv:fs:${symbol}`, {
    ttlMs: 15 * 60_000,
    staleMs: 2 * 3_600_000,
    producer: async () => {
      try {
        return await fetchVndirectFinancials(symbol, { limitPeriods: 16 });
      } catch {
        return null;
      }
    },
  }).then((r) => r.value);

  const quoteP = getVnQuotes([symbol]).catch(() => null);

  const equityP = cached(`fv:equity:${symbol}`, {
    ttlMs: 2 * 3_600_000,
    staleMs: 12 * 3_600_000,
    producer: async () => {
      try {
        return await getVndEquitySnapshot(symbol);
      } catch {
        return null;
      }
    },
  }).then((r) => r.value);

  const ratiosP = cached(`fv:ratios:${symbol}`, {
    ttlMs: 5 * 60_000,
    staleMs: 60 * 60_000,
    producer: async () => {
      try {
        return await getVndValuationRatios(symbol);
      } catch {
        return null;
      }
    },
  }).then((r) => r.value);

  const peersP = wantPeers
    ? collectPeerMetrics(symbol, 4).catch(() => null)
    : Promise.resolve(null);

  const [fs, quotes, equity, vndRatios, peerPack] = await Promise.all([
    fsP,
    quoteP,
    equityP,
    ratiosP,
    peersP,
  ]);

  const priceQuote =
    quotes?.quotes?.[0]?.price && quotes.quotes[0].price > 0 ? quotes.quotes[0].price : 0;
  const priceSource = quotes?.meta?.source ?? "vndirect";
  const priceVnd = priceQuoteToVnd(priceQuote);

  if (!fs?.periods?.length && priceQuote <= 0 && !vndRatios?.marketCap) {
    return null;
  }

  const notes: string[] = [];
  notes.push(
    "Pipeline độc lập — giá realtime + ratios + BCTC VNDirect + DCF 2 giai đoạn.",
  );
  if (priceQuote > 0 && priceQuote < 500) {
    notes.push(`Giá quote ${priceQuote} → ${priceVnd.toLocaleString("vi-VN")} VND (×1000 nghìn đồng).`);
  }

  let health: FinancialHealthResult;
  if (fs?.periods?.length) {
    const rows = periodsToLegacyRows(fs.periods, symbol);
    health = computeFinancialHealth(
      {
        income: rows.income as Record<string, unknown>[],
        balance: rows.balance as Record<string, unknown>[],
        cashflow: rows.cashflow as Record<string, unknown>[],
      },
      { symbol },
    );
    notes.push(`BCTC: ${fs.periods.length} kỳ · latency ${fs.latencyMs}ms · nguồn vndirect-fs`);
  } else {
    health = computeFinancialHealth(
      { income: [], balance: [], cashflow: [] },
      { symbol },
    );
    notes.push("Không lấy được BCTC từ VNDirect — dùng ratios/giá thị trường.");
  }

  let sharesOutstanding: number | null = health.anchors?.shares ?? null;
  let sharesSource: string | null = sharesOutstanding != null ? "financial-statements" : null;
  let sharesReportDate: string | null = null;
  let marketCapReported: number | null = null;

  if (equity?.sharesOutstanding && equity.sharesOutstanding > 0) {
    sharesOutstanding = equity.sharesOutstanding;
    sharesSource = equity.source;
    sharesReportDate = equity.reportDate;
    marketCapReported = equity.marketCapReported;
  }
  if (vndRatios?.marketCap && vndRatios.marketCap > 0) {
    marketCapReported = vndRatios.marketCap;
  }

  let epsTtm = health.anchors.epsTtm;
  if ((epsTtm == null || !Number.isFinite(epsTtm)) && vndRatios?.eps != null) {
    epsTtm = vndRatios.eps;
    notes.push(`EPS từ VNDirect ratios: ${epsTtm}`);
  }
  if (
    (epsTtm == null || !Number.isFinite(epsTtm)) &&
    vndRatios?.pe &&
    vndRatios.pe > 0 &&
    priceQuote > 0
  ) {
    epsTtm = priceQuote / vndRatios.pe;
    notes.push(`EPS suy từ giá quote / PE ratios`);
  }

  // FCF proxy cho DCF: ưu tiên FCF; fallback 70% LN ròng nếu FCF ≤ 0
  let fcfProxy = health.anchors.fcfTtm;
  if ((fcfProxy == null || fcfProxy <= 0) && health.anchors.netProfit != null && health.anchors.netProfit > 0) {
    fcfProxy = health.anchors.netProfit * 0.7;
    notes.push("FCF proxy = 70% LN ròng (thiếu OCF−CAPEX dương)");
    health = {
      ...health,
      anchors: { ...health.anchors, fcfTtm: fcfProxy },
    };
  }

  health = {
    ...health,
    anchors: {
      ...health.anchors,
      shares: sharesOutstanding ?? health.anchors.shares,
      epsTtm:
        epsTtm ??
        (health.anchors.netProfit != null && sharesOutstanding && sharesOutstanding > 0
          ? health.anchors.netProfit / sharesOutstanding
          : health.anchors.epsTtm),
    },
  };

  const marketCapFromPrice =
    priceVnd > 0 && sharesOutstanding != null && sharesOutstanding > 0
      ? priceVnd * sharesOutstanding
      : null;
  const marketCapPreferred =
    marketCapReported && marketCapReported > 1e9
      ? marketCapReported
      : marketCapFromPrice ?? marketCapReported;

  if (marketCapPreferred) {
    notes.push(`Vốn hóa: ${Math.round(marketCapPreferred).toLocaleString("vi-VN")} VND`);
  }

  const peerComparison =
    peerPack && peerPack.peers && peerPack.peers.length > 0
      ? {
          symbol,
          sector: peerPack.sector ?? sectorOf(symbol),
          subject: {
            symbol,
            pe: vndRatios?.pe ?? null,
            pb: vndRatios?.pb ?? null,
            ps: vndRatios?.ps ?? null,
            evEbitda: null as number | null,
          },
          peers: peerPack.peers,
        }
      : undefined;

  const valuation = computeValuation({
    price: priceQuote > 0 ? priceQuote : 0,
    health,
    symbol,
    peerComparison: peerComparison as Parameters<typeof computeValuation>[0]["peerComparison"],
  });

  const fv = valuation.fairValue ?? null;
  const p4 = valuation.phase4 ?? null;
  const p5 = valuation.phase5 ?? null;
  const p3 = valuation.phase3 ?? null;

  const eng = valuation.multiples;
  const multiples = {
    pe: saneMultiple(eng.pe) ?? saneMultiple(vndRatios?.pe ?? null) ?? null,
    pb: saneMultiple(eng.pb, 50) ?? saneMultiple(vndRatios?.pb ?? null, 50) ?? null,
    ps: saneMultiple(eng.ps, 100) ?? saneMultiple(vndRatios?.ps ?? null, 100) ?? null,
    peg: eng.peg,
    pcf: saneMultiple(eng.pcf) ?? null,
    pfcf: saneMultiple(eng.pfcf) ?? null,
    evEbitda: saneMultiple(eng.evEbitda) ?? null,
    evEbit: eng.evEbit,
    evSales: saneMultiple(eng.evSales) ?? null,
    evFcff: saneMultiple(eng.evFcff) ?? null,
    fcfYield: saneYieldPct(eng.fcfYield),
    dividendYield:
      saneYieldPct(eng.dividendYield) ??
      (vndRatios?.dividendYield != null
        ? Number((vndRatios.dividendYield * 100).toFixed(2))
        : null),
    earningsYield: saneYieldPct(eng.earningsYield),
  };

  if (vndRatios?.pe || vndRatios?.pb || vndRatios?.ps) {
    notes.push(
      `Ratios VNDirect: PE ${vndRatios.pe?.toFixed(1) ?? "—"} · PB ${vndRatios.pb?.toFixed(2) ?? "—"} · PS ${vndRatios.ps?.toFixed(2) ?? "—"}`,
    );
  }

  let blended = p5?.finalFairValue ?? fv?.blendedFairValue ?? null;
  if (blended == null && priceQuote > 0) {
    const estimates: number[] = [];
    if (vndRatios?.eps && vndRatios.eps > 0 && multiples.pe && multiples.pe > 0) {
      estimates.push(vndRatios.eps * multiples.pe);
    }
    if (vndRatios?.bvps && vndRatios.bvps > 0 && multiples.pb && multiples.pb > 0) {
      estimates.push(vndRatios.bvps * multiples.pb);
    }
    if (estimates.length) {
      blended = estimates.reduce((a, b) => a + b, 0) / estimates.length;
      notes.push(`FV ước lượng từ EPS/BVPS × multiple (ratios)`);
    }
  }

  const upside =
    p5?.score?.upsidePct ??
    fv?.upsidePct ??
    (blended != null && priceQuote > 0
      ? Number((((blended / priceQuote) - 1) * 100).toFixed(1))
      : null);

  const resolvedMarketCap =
    marketCapPreferred ?? valuation.marketCap ?? marketCapFromPrice;

  let enterpriseValue = valuation.enterpriseValue;
  if (
    resolvedMarketCap &&
    enterpriseValue != null &&
    resolvedMarketCap > 1e12 &&
    enterpriseValue < resolvedMarketCap / 50
  ) {
    enterpriseValue = resolvedMarketCap;
    notes.push("EV căn theo MARKETCAP (điều chỉnh lệch đơn vị).");
  }

  // DCF chi tiết luôn trả về (không chỉ full)
  const dcfScenarios = (p3?.dcf ?? valuation.dcf ?? []).map((d) => {
    const row = d as {
      label: string;
      status?: string;
      baseFcf?: number;
      fairPrice?: number | null;
      fairPriceQuote?: number | null;
      upsidePct?: number | null;
      equityValue?: number | null;
      terminalValue?: number | null;
      pvTerminal?: number | null;
      pvExplicit?: number | null;
      terminalShareOfValue?: number | null;
      assumptions?: Record<string, unknown>;
      explicitYears?: unknown[];
      notes?: string[];
      growthY1to5?: number;
      terminalGrowth?: number;
      discountRate?: number;
      intrinsicPerShare?: number;
      marginOfSafetyPct?: number;
    };n    // Hỗ trợ cả DcfResult phase3 và DcfScenario legacy
    if (row.assumptions) {
      return {
        label: row.label,
        status: row.status,
        baseFcf: row.baseFcf,
        fairPrice: row.fairPrice,
        fairPriceQuote: row.fairPriceQuote,
        upsidePct: row.upsidePct,
        equityValue: row.equityValue,
        terminalValue: row.terminalValue,
        pvTerminal: row.pvTerminal,
        pvExplicit: row.pvExplicit,
        terminalShareOfValue: row.terminalShareOfValue,
        assumptions: row.assumptions,
        explicitYears: row.explicitYears ?? [],
        notes: row.notes ?? [],
      };
    }
    return {
      label: row.label,
      status: "ok",
      fairPriceQuote: row.intrinsicPerShare ?? null,
      fairPrice: row.intrinsicPerShare != null ? row.intrinsicPerShare * 1000 : null,
      upsidePct: row.marginOfSafetyPct ?? null,
      assumptions: {
        forecastYears: 5,
        highGrowthYears: 3,
        growthY1toN: row.growthY1to5,
        terminalGrowth: row.terminalGrowth,
        discountRate: row.discountRate,
        terminalMethod: "gordon",
        cashFlowType: "fcf_proxy",
      },
      explicitYears: [],
      notes: [],
    };
  });

  const allNotes = [...notes, ...(valuation.notes ?? [])].slice(0, 40);

  const data: Record<string, unknown> = {
    symbol,
    currentPrice: priceQuote > 0 ? priceQuote : valuation.price,
    priceVnd: priceVnd > 0 ? priceVnd : null,
    priceSource,
    sharesOutstanding,
    sharesSource,
    sharesReportDate,
    marketCap: resolvedMarketCap,
    marketCapReported,
    marketSnapshot: {
      price: priceQuote > 0 ? priceQuote : valuation.price,
      priceVnd,
      priceSource,
      sharesOutstanding,
      sharesSource,
      sharesReportDate,
      marketCap: resolvedMarketCap,
      marketCapReported,
      enterpriseValue: enterpriseValue ?? null,
    },
    enterpriseValue,
    multiples,
    vndirectRatios: vndRatios
      ? {
          pe: vndRatios.pe,
          pb: vndRatios.pb,
          ps: vndRatios.ps,
          eps: vndRatios.eps,
          bvps: vndRatios.bvps,
          roe: vndRatios.roe,
          roa: vndRatios.roa,
          dividendYield: vndRatios.dividendYield,
          marketCap: vndRatios.marketCap,
          reportDate: vndRatios.reportDate,
          source: vndRatios.source,
        }
      : null,
    fairValues: {
      blended,
      low: p5?.confidenceBands?.low ?? null,
      base: p5?.confidenceBands?.base ?? null,
      high: p5?.confidenceBands?.high ?? null,
      bandWidthPct: p5?.confidenceBands?.bandWidthPct ?? null,
      dcfBase: fv?.methods?.dcfBase ?? null,
      dcfBear: fv?.methods?.dcfBear ?? null,
      dcfBull: fv?.methods?.dcfBull ?? null,
      peBased: fv?.methods?.peBased ?? null,
      pbBased: fv?.methods?.pbBased ?? null,
      evEbitdaBased: fv?.methods?.evEbitdaBased ?? null,
      pfcfBased: fv?.methods?.pfcfBased ?? null,
      residualIncome: p4?.methodPrices?.residualIncome ?? null,
      ddm: p4?.methodPrices?.ddm ?? null,
      nav: p4?.methodPrices?.nav ?? null,
      sotp: p4?.methodPrices?.sotp ?? null,
      industryWeightsApplied: p5?.score?.industryBlend?.weightsApplied ?? null,
      weightsUsed: fv?.weightsUsed ?? null,
      dcf: valuation.dcf,
    },
    /** Chi tiết DCF 2 giai đoạn — luôn có cho UI */
    dcfDetail: {
      scenarios: dcfScenarios,
      sensitivity: valuation.sensitivity ?? p3?.sensitivity ?? null,
      costOfCapital: p3?.costOfCapital ?? null,
      engineVersion: p3?.valuationEngineVersion ?? null,
    },
    sensitivity: valuation.sensitivity ?? null,
    valuationScore: p5?.valuationScore ?? null,
    valuationGrade: p5?.grade ?? null,
    valuationScoreBreakdown: p5?.score?.breakdown ?? null,
    valuationStatus: p5?.valuationStatus ?? fv?.valuationStatus ?? null,
    upsideDownside: upside,
    confidence: valuation.confidence,
    valuationConfidence: fv?.confidence ?? null,
    confidenceBands: p5?.confidenceBands ?? null,
    dataQuality: valuation.dataQuality,
    industryProfile: p5?.profileId ?? null,
    industryMethodWeights: p5?.industryWeights ?? null,
    historical: valuation.historical ?? null,
    peerComparison: valuation.peers ?? null,
    health: {
      score: health.scores?.overall ?? null,
      scores: health.scores,
      coverage: health.coverage,
      anchors: health.anchors,
      groups: health.groups,
      warnings: health.warnings?.slice(0, 8),
      riskFlags: health.riskFlags?.slice(0, 8),
      industry: health.industry,
    },
    assumptions: {
      dcf: dcfScenarios.map((d) => ({
        label: d.label,
        growthY1toN: (d.assumptions as { growthY1toN?: number })?.growthY1toN,
        terminalGrowth: (d.assumptions as { terminalGrowth?: number })?.terminalGrowth,
        discountRate: (d.assumptions as { discountRate?: number })?.discountRate,
        highGrowthYears: (d.assumptions as { highGrowthYears?: number })?.highGrowthYears,
        forecastYears: (d.assumptions as { forecastYears?: number })?.forecastYears,
        status: d.status,
      })),
      costOfCapital: p3?.costOfCapital ?? null,
      fcfDefinition: valuation.phase2?.cashFlow?.fcfDefinition ?? null,
    },
    notes: allNotes,
    pipeline: "fundamental-valuation-direct-v3-dcf",
    calculatedAt: new Date().toISOString(),
    valuationEngineVersion: valuation.valuationEngineVersion,
  };

  if (wantFull) {
    data.phase1 = valuation.phase1 ?? null;
    data.phase2 = valuation.phase2 ?? null;
    data.phase3 = p3 ?? null;
    data.phase4 = p4 ?? null;
    data.phase5 = p5 ?? null;
    data.sources = valuation.phase1?.sources ?? [];
    data.fsPeriodCount = fs?.periods?.length ?? 0;
  }

  const meta = buildMeta({
    source: `fundamental-direct+${priceSource}+vndirect-fs+ratios+dcf`,
    sourceTimestampMs: Date.now(),
    note: allNotes[0] ?? "Định giá độc lập từ VNDirect + DCF",
  });

  return { symbol, data, meta, health };
}
