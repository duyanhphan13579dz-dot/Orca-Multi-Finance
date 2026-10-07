/**
 * Phase 4 — Residual Income, DDM, NAV, SOTP tests.
 */
import {
  runResidualIncome,
  runDdm,
  runNav,
  runSotp,
  estimateDps,
  buildPhase4Valuation,
} from "../engines/valuation-phase4";

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

console.log("\n=== Residual Income ===");
{
  const ri = runResidualIncome({
    bookEquity: 1e12,
    netIncomeTtm: 1.5e11,
    costOfEquity: 0.12,
    shares: 1e9,
    currentPrice: 80000,
    niGrowth: 0.05,
    terminalGrowth: 0.02,
  });
  assert(ri.status === "ok" || ri.status === "incomplete", "RI runs");
  assert(ri.fairPrice != null && ri.fairPrice > 0, "RI fair price");
  assert(ri.residualIncomes.length === 5, "5 RI years");

  const bad = runResidualIncome({
    bookEquity: 1e12,
    netIncomeTtm: 1e11,
    costOfEquity: 0.02,
    shares: 1e9,
    currentPrice: 100,
    terminalGrowth: 0.05,
  });
  assert(bad.status === "invalid", "g >= Ke invalid");
}

console.log("\n=== DDM ===");
{
  const g = runDdm({
    dps: 3000,
    costOfEquity: 0.12,
    currentPrice: 50000,
    growthStable: 0.03,
  });
  assert(g.model === "gordon" && g.fairPrice != null, "Gordon DDM");
  assert(g.fairPrice === 34333, "Gordon price ~34333");

  const none = runDdm({
    dps: null,
    costOfEquity: 0.12,
    currentPrice: 50000,
  });
  assert(none.status === "not_applicable", "no DPS → N/A");

  const two = runDdm({
    dps: 2000,
    costOfEquity: 0.12,
    currentPrice: 40000,
    growthStable: 0.03,
    growthHigh: 0.1,
    highGrowthYears: 5,
  });
  assert(two.model === "two_stage" && two.fairPrice != null, "two-stage DDM");
}

console.log("\n=== DPS estimate ===");
{
  const d = estimateDps({
    dividendsAnnual: 1e12,
    shares: 5e8,
    dividendYield: null,
    price: null,
  });
  assert(d.status === "ok" && d.value === 2000, "DPS=2000");
}

console.log("\n=== NAV ===");
{
  const n = runNav({
    totalAssets: 2e12,
    totalLiabilities: 8e11,
    bookEquity: 1.2e12,
    shares: 1e9,
    currentPrice: 100000,
  });
  assert(n.status === "ok" && n.navPerShare === 1200, "NAV/share=1200");
}

console.log("\n=== SOTP ===");
{
  const s = runSotp({
    segments: [
      { name: "Core", value: 5e12, valueType: "equity" },
      { name: "SubA", value: 2e12, valueType: "enterprise" },
    ],
    netDebt: 5e11,
    shares: 1e9,
    currentPrice: 6000,
    holdingDiscount: 0.1,
  });
  assert(s.status === "ok" && s.fairPrice === 5850, "SOTP fair=5850");

  const empty = runSotp({ segments: [] });
  assert(empty.status === "not_applicable", "empty SOTP N/A");
}

console.log("\n=== Phase4 aggregate ===");
{
  const r = buildPhase4Valuation({
    currentPrice: 80000,
    shares: 1e9,
    bookEquity: 1e12,
    netIncomeTtm: 1.2e11,
    costOfEquity: 0.11,
    dividendsAnnual: 4e10,
    industryProfileId: "BANKING",
  });
  assert(r.residualIncome != null, "RI present");
  assert(r.ddm != null, "DDM present");
  assert(r.nav != null, "NAV present");
  assert(r.valuationEngineVersion.includes("phase4"), "version");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
