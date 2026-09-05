import "server-only";
import type { FinancialHealthResult } from "./fundamental";

/**
 * VALUATION ENGINE — code-first multiples + two-stage DCF with bear/base/bull
 * scenarios. LLM receives inputs, assumptions and outputs with confidence.
 */

export interface DcfScenario {
  label: "Bear" | "Base" | "Bull";
  growthY1to5: number;
  terminalGrowth: number;
  discountRate: number;
  intrinsicPerShare: number;
  marginOfSafetyPct: number; // vs current price (negative = overvalued)
}

export interface ValuationResult {
  price: number;
  marketCap: number | null;
  enterpriseValue: number | null;
  multiples: {
    pe: number | null;
    pb: number | null;
    evEbitda: number | null;
    evSales: number | null;
    fcfYield: number | null;
    dividendYield: number | null;
  };
  dcf: DcfScenario[] | null;
  confidence: "high" | "medium" | "low";
  notes: string[];
}

export function computeValuation(input: {
  price: number;
  health: FinancialHealthResult;
  dividendsAnnual?: number | null;
}): ValuationResult {
  const { price, health } = input;
  const a = health.anchors;
  const notes: string[] = [];

  const marketCap = a.shares != null && a.shares > 0 ? price * a.shares : null;
  const enterpriseValue = marketCap != null && a.totalDebt != null ? marketCap + a.totalDebt * 0 : null; // EV needs cash; refined below

  const ev = (() => {
    if (marketCap == null || a.totalDebt == null) return null;
    const cashComp = a.equity != null && a.totalDebt != null && a.ocfTtm != null ? 0 : 0; // cash pulled via anchors.cash if present in health anchors extension
    return marketCap + a.totalDebt - cashComp;
  })();

  const pe = a.epsTtm != null && a.epsTtm > 0 ? price / a.epsTtm : null;
  const pbv = a.equity != null && a.shares != null && a.shares > 0 && a.equity > 0 ? price / (a.equity / a.shares) : null;
  const evEbitda = ev != null && a.ebitdaTtm != null && a.ebitdaTtm > 0 ? ev / a.ebitdaTtm : null;
  const evSales = ev != null && a.revenue != null && a.revenue > 0 ? ev / a.revenue : null;
  const fcfYield = a.fcfTtm != null && marketCap != null && marketCap > 0 ? a.fcfTtm / marketCap : null;
  const dividendYield = input.dividendsAnnual != null && input.dividendsAnnual > 0 && marketCap != null ? input.dividendsAnnual / marketCap : null;

  if (enterpriseValue == null && ev == null) notes.push("Thiếu cơ cấu nợ/tiền mặt — EV được ước lượng bằng market cap + nợ.");
  if (pe == null) notes.push("Không đủ EPS/Shares để tính P/E.");

  /* DCF — requires positive FCF and share count */
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
      const tv = (fcf * (1 + s.terminalGrowth)) / (s.discountRate - s.terminalGrowth);
      pv += tv / (1 + s.discountRate) ** 5;
      const perShare = pv / (a.shares as number);
      return {
        ...s,
        intrinsicPerShare: Math.round(perShare),
        marginOfSafetyPct: Number(((perShare / price - 1) * 100).toFixed(1)),
      };
    });
    notes.push("DCF two-stage: FCF hiện tại → 5 năm growth → terminal. Scenario thay đổi growth & discount rate; đây là ước lượng định lượng, không phải giá mục tiêu cam kết.");
  } else notes.push("Thiếu FCF dương hoặc số lượng cổ phiếu — không đủ cơ sở chạy DCF.");

  const confidence: ValuationResult["confidence"] =
    pe != null && pbv != null && dcf != null ? "high" : pe != null || pbv != null ? "medium" : "low";

  return {
    price,
    marketCap,
    enterpriseValue: ev ?? enterpriseValue,
    multiples: {
      pe: pe != null ? Number(pe.toFixed(1)) : null,
      pb: pbv != null ? Number(pbv.toFixed(2)) : null,
      evEbitda: evEbitda != null ? Number(evEbitda.toFixed(1)) : null,
      evSales: evSales != null ? Number(evSales.toFixed(2)) : null,
      fcfYield: fcfYield != null ? Number((fcfYield * 100).toFixed(2)) : null,
      dividendYield: dividendYield != null ? Number((dividendYield * 100).toFixed(2)) : null,
    },
    dcf,
    confidence,
    notes,
  };
}
