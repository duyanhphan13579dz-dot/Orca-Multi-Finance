/**
 * Phase 3 — DCF, sensitivity, fair value aggregator tests.
 */
import {
  runDcf,
  calcWacc,
  calcCostOfEquity,
  buildSensitivityMatrix,
  fairFromMultiple,
  aggregateFairValue,
  buildPhase3Valuation,
  defaultDcfScenarios,
} from "../engines/valuation-phase3";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log("  ✓", msg);
  } else {
    failed++;
    console.error("  ✗", msg);
  }
}
function approx(a: number | null, b: number, tol = 1) {
  return a != null && Math.abs(a - b) <= tol;
}

console.log("\n=== Cost of equity / WACC ===");
{
  const ke = calcCostOfEquity({ riskFreeRate: 0.03, beta: 1, equityRiskPremium: 0.08 });
  assert(ke.status === "ok" && approx(ke.value, 0.11, 0.001), "Ke=11%");
  const w = calcWacc({
    equityValue: 700,
    debtValue: 300,
    costOfEquity: 0.11,
    costOfDebt: 0.07,
    taxRate: 0.2,
  });
  assert(w.status === "ok" && approx(w.value, 0.0938, 0.001), "WACC≈9.4%");
}

console.log("\n=== DCF Gordon guard ===");
{
  const bad = runDcf({
    baseFcf: 100,
    shares: 10,
    currentPrice: 50,
    assumptions: {
      label: "Base",
      forecastYears: 5,
      growthY1toN: 0.08,
      terminalGrowth: 0.12,
      discountRate: 0.1,
      cashFlowType: "fcf_proxy",
    },
  });
  assert(bad.status === "invalid", "g >= r → invalid");

  const okDcf = runDcf({
    baseFcf: 1_000_000_000,
    shares: 100_000_000,
    currentPrice: 50_000,
    assumptions: {
      label: "Base",
      forecastYears: 5,
      growthY1toN: 0.08,
      terminalGrowth: 0.025,
      discountRate: 0.12,
      cashFlowType: "fcf_proxy",
    },
  });
  assert(okDcf.status === "ok" || okDcf.status === "incomplete", "valid DCF runs");
  assert(okDcf.fairPrice != null && okDcf.fairPrice > 0, "fair price > 0");
  assert(okDcf.explicitYears.length === 5, "5 explicit years");
  assert(okDcf.terminalValue != null && okDcf.terminalValue > 0, "TV > 0");
}

console.log("\n=== Sensitivity ===");
{
  const m = buildSensitivityMatrix({
    baseFcf: 1e9,
    shares: 1e8,
    currentPrice: 50000,
    baseWacc: 0.12,
    baseGrowth: 0.025,
  });
  assert(m.waccAxis.length === 5 && m.growthAxis.length === 5, "5x5 matrix");
  const invalidCells = m.cells.flat().filter((c) => !c.valid);
  assert(invalidCells.length >= 1, "some cells invalid when g>=wacc");
  const validCells = m.cells.flat().filter((c) => c.valid);
  assert(validCells.length >= 10, "most cells valid");
}

console.log("\n=== Fair from multiple ===");
{
  const pe = fairFromMultiple({ method: "pe", fairMultiple: 15, eps: 5000 });
  assert(pe.status === "ok" && pe.fairPrice === 75000, "PE fair=75k");
  assert(
    fairFromMultiple({ method: "pe", fairMultiple: 15, eps: -1 }).status === "not_applicable",
    "neg EPS N/A",
  );
}

console.log("\n=== Aggregate fair value ===");
{
  const scenarios = defaultDcfScenarios(0.12).map((a) =>
    runDcf({
      baseFcf: 2e9,
      shares: 1e8,
      currentPrice: 80000,
      assumptions: a,
    }),
  );
  const agg = aggregateFairValue({
    currentPrice: 80000,
    dcfResults: scenarios,
    multipleFairs: [
      fairFromMultiple({ method: "pe", fairMultiple: 12, eps: 7000 }),
      fairFromMultiple({ method: "pb", fairMultiple: 2, bvps: 40000 }),
    ],
    dataQuality: 80,
  });
  assert(agg.blendedFairValue != null && agg.blendedFairValue > 0, "blended FV");
  assert(agg.weightsUsed.dcf > 0, "dcf weight > 0");
  assert(agg.valuationStatus !== "insufficient_data", "has status");
}

console.log("\n=== Phase3 builder ===");
{
  const r = buildPhase3Valuation({
    currentPrice: 100000,
    shares: 500_000_000,
    baseFcf: 5e12,
    netDebt: 1e12,
    marketCap: 50e12,
    totalDebt: 2e12,
    riskFreeRate: 0.03,
    beta: 1.1,
    equityRiskPremium: 0.08,
    taxRate: 0.2,
    fairPe: 15,
    fairPb: 2.5,
    epsTtm: 6000,
    bvps: 45000,
    ebitdaTtm: 8e12,
    fcfTtm: 5e12,
    dataQuality: 75,
  });
  assert(r.dcf.length === 3, "3 scenarios");
  assert(r.sensitivity != null, "sensitivity present");
  assert(r.fairValue.blendedFairValue != null, "blended FV");
  assert(r.valuationEngineVersion.includes("phase3"), "version");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
