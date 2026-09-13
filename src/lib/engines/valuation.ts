import "server-only";
import type { FinancialHealthResult } from "./fundamental";
import { getIndustryProfile } from "../financial/industry-profiles";
import {
  buildPhase1Valuation,
  inputsFromHealthAnchors,
  type Phase1ValuationResult,
} from "./valuation-phase1";
import {
  buildPhase2Valuation,
  type Phase2ValuationResult,
  type PeerMetricRow,
  type HistoricalSummary,
} from "./valuation-phase2";
import {
  buildPhase3Valuation,
  type Phase3ValuationResult,
  type FairValueAggregate,
  type SensitivityMatrix,
  type DcfResult,
} from "./valuation-phase3";
import {
  buildPhase4Valuation,
  type Phase4ValuationResult,
  type SotPSegment,
} from "./valuation-phase4";
import {
  buildPhase5Valuation,
  VALUATION_ENGINE_VERSION_PHASE5,
  type Phase5ValuationResult,
} from "./valuation-phase5";

/** @deprecated legacy shape kept for intelligence consumers */
export interface DcfScenario {
  label: "Bear" | "Base" | "Bull";
  growthY1to5: number;
  terminalGrowth: number;
  discountRate: number;
  intrinsicPerShare: number;
  marginOfSafetyPct: number;
}

export interface ValuationResult {
  price: number;
  marketCap: number | null;
  enterpriseValue: number | null;
  multiples: {
    pe: number | null;
    pb: number | null;
    ps: number | null;
    peg: number | null;
    pcf: number | null;
    pfcf: number | null;
    evEbitda: number | null;
    evEbit: number | null;
    evSales: number | null;
    evFcff: number | null;
    fcfYield: number | null;
    dividendYield: number | null;
    earningsYield: number | null;
  };
  phase1?: Phase1ValuationResult;
  phase2?: Phase2ValuationResult;
  phase3?: Phase3ValuationResult;
  phase4?: Phase4ValuationResult;
  phase5?: Phase5ValuationResult;
  historical?: HistoricalSummary | null;
  peers?: Phase2ValuationResult["peers"];
  dcf: DcfScenario[] | null;
  fairValue?: FairValueAggregate | null;
  sensitivity?: SensitivityMatrix | null;
  confidence: "high" | "medium" | "low";
  dataQuality: number | null;
  notes: string[];
  valuationEngineVersion: string;
}

function mapLegacyDcf(results: DcfResult[]): DcfScenario[] {
  return results
    .filter((d) => d.label === "Bear" || d.label === "Base" || d.label === "Bull")
    .map((d) => ({
      label: d.label as "Bear" | "Base" | "Bull",
      growthY1to5: d.assumptions.growthY1toN,
      terminalGrowth: d.assumptions.terminalGrowth,
      discountRate: d.assumptions.discountRate,
      intrinsicPerShare: d.fairPrice ?? 0,
      marginOfSafetyPct: d.upsidePct ?? 0,
    }));
}

function blendWithPhase4(
  base: FairValueAggregate,
  phase4: Phase4ValuationResult,
): FairValueAggregate {
  const extra: { key: string; price: number; weight: number }[] = [];
  if (phase4.methodPrices.residualIncome != null) {
    extra.push({ key: "ri", price: phase4.methodPrices.residualIncome, weight: 0.12 });
  }
  if (phase4.methodPrices.ddm != null) {
    extra.push({ key: "ddm", price: phase4.methodPrices.ddm, weight: 0.1 });
  }
  if (phase4.methodPrices.nav != null) {
    extra.push({ key: "nav", price: phase4.methodPrices.nav, weight: 0.1 });
  }
  if (phase4.methodPrices.sotp != null) {
    extra.push({ key: "sotp", price: phase4.methodPrices.sotp, weight: 0.08 });
  }
  if (!extra.length || base.blendedFairValue == null) return base;

  const baseWeight = Math.max(0.5, 1 - extra.reduce((s, e) => s + e.weight, 0));
  let sumW = baseWeight;
  let sum = base.blendedFairValue * baseWeight;
  for (const e of extra) {
    sumW += e.weight;
    sum += e.price * e.weight;
  }
  const blended = Math.round(sum / sumW);
  const upside =
    base.currentPrice != null && base.currentPrice > 0
      ? Number((((blended / base.currentPrice) - 1) * 100).toFixed(1))
      : base.upsidePct;

  return {
    ...base,
    blendedFairValue: blended,
    upsidePct: upside,
    notes: [
      ...base.notes,
      `Phase4 blend: +${extra.map((e) => e.key).join(",")} → FV ${blended}`,
    ],
  };
}

export function computeValuation(input: {
  price: number;
  health: FinancialHealthResult;
  dividendsAnnual?: number | null;
  ebitTtm?: number | null;
  taxRate?: number | null;
  daTtm?: number | null;
  deltaNwc?: number | null;
  netBorrowing?: number | null;
  capexTtm?: number | null;
  historicalRows?: Parameters<typeof buildPhase2Valuation>[0]["historicalRows"];
  peerComparison?: {
    symbol: string;
    sector: string | null;
    subject: PeerMetricRow;
    peers: PeerMetricRow[];
  };
  riskFreeRate?: number | null;
  beta?: number | null;
  equityRiskPremium?: number | null;
  costOfDebt?: number | null;
  fairPe?: number | null;
  fairPb?: number | null;
  fairEvEbitda?: number | null;
  fairPfcf?: number | null;
  symbol?: string;
  sotpSegments?: SotPSegment[];
  fairValueAdjustments?: number | null;
  holdingDiscount?: number | null;
}): ValuationResult {
  const { price, health } = input;
  const a = health.anchors;
  const notes: string[] = [];

  const phase1 = buildPhase1Valuation(
    inputsFromHealthAnchors({
      price,
      anchors: {
        revenue: a.revenue,
        netProfit: a.netProfit,
        equity: a.equity,
        totalDebt: a.totalDebt,
        ocfTtm: a.ocfTtm,
        fcfTtm: a.fcfTtm,
        shares: a.shares,
        epsTtm: a.epsTtm,
        ebitdaTtm: a.ebitdaTtm,
        cash: a.cash ?? null,
      },
      source: "financial-health-anchors",
    }),
  );

  const marketCap = phase1.multiples.marketCap.value;
  const ev = phase1.multiples.enterpriseValue.value;
  const pe = phase1.multiples.pe.value;
  const pb = phase1.multiples.pb.value;
  const ps = phase1.multiples.ps.value;
  const evEbitda = phase1.multiples.evEbitda.value;
  const evSales = phase1.multiples.evSales.value;
  const earningsYield = phase1.multiples.earningsYield.value;
  notes.push(...phase1.notes);

  const phase2 = buildPhase2Valuation({
    marketCap,
    enterpriseValue: ev,
    ocfTtm: a.ocfTtm,
    capexTtm: input.capexTtm ?? null,
    fcfTtm: a.fcfTtm,
    ebitTtm: input.ebitTtm ?? null,
    taxRate: input.taxRate ?? null,
    daTtm: input.daTtm ?? null,
    deltaNwc: input.deltaNwc ?? null,
    netIncomeTtm: a.netProfit,
    netBorrowing: input.netBorrowing ?? null,
    historicalRows: input.historicalRows,
    currentMultiples: { pe, pb, evEbitda },
    peerComparison: input.peerComparison,
  });
  notes.push(...phase2.notes);

  const pfcf = phase2.cashFlow.pfcf.value;
  const pcf = phase2.cashFlow.pcf.value;
  const fcfYieldCell = phase2.cashFlow.fcfYield.value;
  const evFcff = phase2.cashFlow.evFcff.value;

  const fcfYield =
    fcfYieldCell != null
      ? fcfYieldCell
      : a.fcfTtm != null && marketCap != null && marketCap > 0
        ? a.fcfTtm / marketCap
        : null;
  const dividendYield =
    input.dividendsAnnual != null &&
    input.dividendsAnnual > 0 &&
    marketCap != null &&
    marketCap > 0
      ? input.dividendsAnnual / marketCap
      : null;

  const peerMed = phase2.peers?.industry;
  const hist = phase2.historical;
  const fairPe = input.fairPe ?? peerMed?.peMedian ?? hist?.pe.median3y ?? null;
  const fairPb = input.fairPb ?? peerMed?.pbMedian ?? hist?.pb.median3y ?? null;
  const fairEvEbitda =
    input.fairEvEbitda ?? peerMed?.evEbitdaMedian ?? hist?.evEbitda.median3y ?? null;
  const fairPfcf = input.fairPfcf ?? peerMed?.pfcfMedian ?? null;

  const netDebt = a.totalDebt != null ? a.totalDebt - (a.cash ?? 0) : null;
  const bvps =
    a.equity != null && a.shares != null && a.shares > 0 ? a.equity / a.shares : null;

  const phase3 = buildPhase3Valuation({
    currentPrice: price > 0 ? price : null,
    shares: a.shares,
    baseFcf: a.fcfTtm,
    netDebt,
    marketCap,
    totalDebt: a.totalDebt,
    riskFreeRate: input.riskFreeRate ?? 0.03,
    beta: input.beta ?? 1,
    equityRiskPremium: input.equityRiskPremium ?? 0.08,
    costOfDebt: input.costOfDebt ?? null,
    taxRate: input.taxRate ?? 0.2,
    fairPe,
    fairPb,
    fairEvEbitda,
    fairPfcf,
    epsTtm: a.epsTtm,
    bvps,
    ebitdaTtm: a.ebitdaTtm,
    fcfTtm: a.fcfTtm,
    dataQuality: phase1.dataQuality,
  });
  notes.push(...phase3.notes);

  const industryProfileId = input.symbol ? getIndustryProfile(input.symbol).id : null;
  const ke =
    phase3.costOfCapital.costOfEquity.value ??
    phase3.costOfCapital.wacc.value ??
    0.12;

  const phase4 = buildPhase4Valuation({
    currentPrice: price > 0 ? price : null,
    shares: a.shares,
    bookEquity: a.equity,
    netIncomeTtm: a.netProfit,
    costOfEquity: ke,
    totalAssets: null,
    totalLiabilities: null,
    dividendsAnnual: input.dividendsAnnual ?? null,
    dividendYield: dividendYield,
    industryProfileId,
    sotpSegments: input.sotpSegments,
    netDebt,
    fairValueAdjustments: input.fairValueAdjustments ?? null,
    holdingDiscount: input.holdingDiscount ?? null,
  });
  notes.push(...phase4.notes);

  let fairValue = blendWithPhase4(phase3.fairValue, phase4);

  const phase5 = buildPhase5Valuation({
    currentPrice: price > 0 ? price : null,
    dataQuality: phase1.dataQuality,
    profileId: industryProfileId,
    phase3Fair: fairValue,
    phase4,
  });
  notes.push(...phase5.notes);

  if (phase5.finalFairValue != null) {
    fairValue = {
      ...fairValue,
      blendedFairValue: phase5.finalFairValue,
      upsidePct: phase5.score.upsidePct,
      valuationStatus: phase5.valuationStatus,
    };
  }

  const dcfLegacy = mapLegacyDcf(phase3.dcf);
  const dcf = dcfLegacy.length ? dcfLegacy : null;

  const confMap = {
    very_high: "high" as const,
    high: "high" as const,
    medium: "medium" as const,
    low: "low" as const,
    very_low: "low" as const,
  };
  const confidence =
    confMap[fairValue.confidence] ??
    (pe != null && pb != null && dcf != null
      ? "high"
      : pe != null || pb != null || evEbitda != null || pfcf != null
        ? "medium"
        : "low");

  return {
    price,
    marketCap,
    enterpriseValue: ev,
    multiples: {
      pe: pe != null ? Number(pe.toFixed(1)) : null,
      pb: pb != null ? Number(pb.toFixed(2)) : null,
      ps: ps != null ? Number(ps.toFixed(2)) : null,
      peg: null,
      pcf: pcf != null ? Number(pcf.toFixed(2)) : null,
      pfcf: pfcf != null ? Number(pfcf.toFixed(2)) : null,
      evEbitda: evEbitda != null ? Number(evEbitda.toFixed(1)) : null,
      evEbit: null,
      evSales: evSales != null ? Number(evSales.toFixed(2)) : null,
      evFcff: evFcff != null ? Number(evFcff.toFixed(2)) : null,
      fcfYield: fcfYield != null ? Number((fcfYield * 100).toFixed(2)) : null,
      dividendYield: dividendYield != null ? Number((dividendYield * 100).toFixed(2)) : null,
      earningsYield: earningsYield != null ? Number((earningsYield * 100).toFixed(2)) : null,
    },
    phase1,
    phase2,
    phase3,
    phase4,
    phase5,
    historical: phase2.historical,
    peers: phase2.peers,
    dcf,
    fairValue,
    sensitivity: phase3.sensitivity,
    confidence,
    dataQuality: phase1.dataQuality,
    notes,
    valuationEngineVersion: VALUATION_ENGINE_VERSION_PHASE5,
  };
}

export { buildPhase1Valuation, inputsFromHealthAnchors } from "./valuation-phase1";
export {
  buildPhase2Valuation,
  buildHistoricalMultiples,
  buildPeerComparison,
  calcFCFF,
  calcFCFE,
  calcPFCF,
} from "./valuation-phase2";
export {
  buildPhase3Valuation,
  runDcf,
  buildSensitivityMatrix,
  aggregateFairValue,
  calcWacc,
  calcCostOfEquity,
} from "./valuation-phase3";
export {
  buildPhase4Valuation,
  runResidualIncome,
  runDdm,
  runNav,
  runSotp,
} from "./valuation-phase4";
export {
  buildPhase5Valuation,
  computeValuationScore,
  blendByIndustry,
  getIndustryMethodWeights,
  VALUATION_ENGINE_VERSION_PHASE5 as VALUATION_ENGINE_VERSION,
} from "./valuation-phase5";
export type { Phase1ValuationResult, ValuationInputs, MetricCell } from "./valuation-phase1";
export type {
  Phase2ValuationResult,
  PeerMetricRow,
  PeerComparisonResult,
  HistoricalSummary,
} from "./valuation-phase2";
export type {
  Phase3ValuationResult,
  FairValueAggregate,
  SensitivityMatrix,
  DcfResult,
  ValuationStatus,
} from "./valuation-phase3";
export type {
  Phase4ValuationResult,
  ResidualIncomeResult,
  DdmResult,
  NavResult,
  SotPResult,
  SotPSegment,
} from "./valuation-phase4";
export type {
  Phase5ValuationResult,
  ValuationScoreResult,
  ConfidenceBands,
  IndustryMethodWeights,
  ScoreGrade,
} from "./valuation-phase5";
