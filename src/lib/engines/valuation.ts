import "server-only";
import type { FinancialHealthResult } from "./fundamental";
import {
  buildPhase1Valuation,
  inputsFromHealthAnchors,
  VALUATION_ENGINE_VERSION,
  type Phase1ValuationResult,
} from "./valuation-phase1";

/**
 * VALUATION ENGINE — extends Phase 1 multiples + two-stage DCF (bear/base/bull).
 * Phase 1 is the single source of truth for P/E, P/B, P/S, EV, EV/EBITDA.
 */

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
    evEbitda: number | null;
    evSales: number | null;
    fcfYield: number | null;
    dividendYield: number | null;
    earningsYield: number | null;
  };
  phase1?: Phase1ValuationResult;
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

  const fcfYield =
    a.fcfTtm != null && marketCap != null && marketCap > 0 ? a.fcfTtm / marketCap : null;
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
      : pe != null || pb != null || evEbitda != null
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
      evEbitda: evEbitda != null ? Number(evEbitda.toFixed(1)) : null,
      evSales: evSales != null ? Number(evSales.toFixed(2)) : null,
      fcfYield: fcfYield != null ? Number((fcfYield * 100).toFixed(2)) : null,
      dividendYield: dividendYield != null ? Number((dividendYield * 100).toFixed(2)) : null,
      earningsYield: earningsYield != null ? Number((earningsYield * 100).toFixed(2)) : null,
    },
    phase1,
    dcf,
    confidence,
    dataQuality: phase1.dataQuality,
    notes,
    valuationEngineVersion: VALUATION_ENGINE_VERSION,
  };
}

export { buildPhase1Valuation, inputsFromHealthAnchors, VALUATION_ENGINE_VERSION };
export type { Phase1ValuationResult, ValuationInputs, MetricCell } from "./valuation-phase1";
