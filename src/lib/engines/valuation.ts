import "server-only";
import type { FinancialHealthResult } from "./fundamental";
import {
  buildPhase1Valuation,
  inputsFromHealthAnchors,
  type Phase1ValuationResult,
} from "./valuation-phase1";
import {
  buildPhase2Valuation,
  VALUATION_ENGINE_VERSION_PHASE2,
  type Phase2ValuationResult,
  type PeerMetricRow,
  type HistoricalSummary,
} from "./valuation-phase2";

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
  historical?: HistoricalSummary | null;
  peers?: Phase2ValuationResult["peers"];
  dcf: DcfScenario[] | null;
  confidence: "high" | "medium" | "low";
  dataQuality: number | null;
  notes: string[];
  valuationEngineVersion: string;
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

  let dcf: DcfScenario[] | null = null;
  if (a.fcfTtm != null && a.fcfTtm > 0 && a.shares != null && a.shares > 0) {
    const scenarios: Omit<DcfScenario, "intrinsicPerShare" | "marginOfSafetyPct">[] = [
      { label: "Bear", growthY1to5: 0.02, terminalGrowth: 0.01, discountRate: 0.14 },
      { label: "Base", growthY1to5: 0.08, terminalGrowth: 0.02, discountRate: 0.12 },
      { label: "Bull", growthY1to5: 0.15, terminalGrowth: 0.025, discountRate: 0.105 },
    ];
    dcf = scenarios.map((s) => {
      const fcf0 = a.fcfTtm as number;
      let pv = 0;
      let fcf = fcf0;
      for (let y = 1; y <= 5; y++) {
        fcf = fcf * (1 + s.growthY1to5);
        pv += fcf / (1 + s.discountRate) ** y;
      }
      const g = Math.min(s.terminalGrowth, s.discountRate - 0.01);
      const tv = (fcf * (1 + g)) / (s.discountRate - g);
      pv += tv / (1 + s.discountRate) ** 5;
      const perShare = pv / (a.shares as number);
      return {
        ...s,
        terminalGrowth: g,
        intrinsicPerShare: Math.round(perShare),
        marginOfSafetyPct: Number(((perShare / price - 1) * 100).toFixed(1)),
      };
    });
    notes.push(
      "DCF two-stage: FCF hiện tại → 5 năm growth → terminal. Scenario thay đổi growth & discount rate; đây là ước lượng định lượng, không phải giá mục tiêu cam kết.",
    );
  } else {
    notes.push("Thiếu FCF dương hoặc số lượng cổ phiếu — không đủ cơ sở chạy DCF.");
  }

  const confidence: ValuationResult["confidence"] =
    pe != null && pb != null && dcf != null
      ? "high"
      : pe != null || pb != null || evEbitda != null || pfcf != null
        ? "medium"
        : "low";

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
    historical: phase2.historical,
    peers: phase2.peers,
    dcf,
    confidence,
    dataQuality: phase1.dataQuality,
    notes,
    valuationEngineVersion: VALUATION_ENGINE_VERSION_PHASE2,
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
  VALUATION_ENGINE_VERSION_PHASE2 as VALUATION_ENGINE_VERSION,
} from "./valuation-phase2";
export type { Phase1ValuationResult, ValuationInputs, MetricCell } from "./valuation-phase1";
export type {
  Phase2ValuationResult,
  PeerMetricRow,
  PeerComparisonResult,
  HistoricalSummary,
} from "./valuation-phase2";
