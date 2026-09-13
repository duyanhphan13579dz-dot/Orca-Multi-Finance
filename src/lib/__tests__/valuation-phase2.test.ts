/**
 * Phase 2 valuation formula tests.
 */
import {
  calcFCFF,
  calcFCFE,
  calcFcfFromOcf,
  calcPFCF,
  calcPCF,
  calcEvFcff,
  buildHistoricalMultiples,
  buildPeerComparison,
  buildPhase2Valuation,
} from "../engines/valuation-phase2";

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
function approx(a: number | null, b: number, tol = 0.01) {
  return a != null && Math.abs(a - b) <= tol;
}

console.log("\n=== FCFF ===");
{
  const full = calcFCFF({ ebit: 100, taxRate: 0.2, da: 10, capex: 20, deltaNwc: 5 });
  assert(full.status === "ok" && approx(full.value, 65), "full FCFF=65");
  const noTax = calcFCFF({ ebit: 100, taxRate: null, da: 10, capex: 20, deltaNwc: 5 });
  assert(noTax.status === "incomplete", "missing tax → incomplete");
  assert(
    calcFCFF({ ebit: null, taxRate: 0.2, da: 0, capex: 0, deltaNwc: 0 }).status === "incomplete",
    "no ebit",
  );
}

console.log("\n=== FCFE ===");
{
  const f = calcFCFE({
    netIncome: 50,
    da: 10,
    capex: 15,
    deltaNwc: 5,
    netBorrowing: 8,
  });
  assert(f.status === "ok" && approx(f.value, 48), "full FCFE=48");
}

console.log("\n=== FCF OCF-CAPEX ===");
{
  const f = calcFcfFromOcf(100, 30);
  assert(f.status === "ok" && approx(f.value, 70), "OCF-CAPEX=70");
  assert(calcFcfFromOcf(100, null).status === "incomplete", "missing capex incomplete");
}

console.log("\n=== P/FCF P/CF EV/FCFF ===");
{
  assert(calcPFCF(1000, 100).status === "ok" && approx(calcPFCF(1000, 100).value, 10), "P/FCF=10");
  assert(calcPFCF(1000, -5).status === "not_applicable", "neg FCF N/A");
  assert(calcPCF(1000, 200).status === "ok" && approx(calcPCF(1000, 200).value, 5), "P/CF=5");
  assert(calcEvFcff(2000, 100).status === "ok" && approx(calcEvFcff(2000, 100).value, 20), "EV/FCFF=20");
}

console.log("\n=== Historical ===");
{
  const h = buildHistoricalMultiples({
    rows: [
      {
        period: "2023",
        year: 2023,
        eps: 10,
        bvps: 50,
        equity: null,
        shares: null,
        revenue: 200,
        ebitda: 40,
        netIncome: null,
        totalDebt: 20,
        cash: 5,
        price: 100,
      },
      {
        period: "2024",
        year: 2024,
        eps: 12,
        bvps: 55,
        equity: null,
        shares: null,
        revenue: 220,
        ebitda: 45,
        netIncome: null,
        totalDebt: 18,
        cash: 6,
        price: 120,
      },
      {
        period: "2025",
        year: 2025,
        eps: 15,
        bvps: 60,
        equity: null,
        shares: null,
        revenue: 250,
        ebitda: 50,
        netIncome: null,
        totalDebt: 15,
        cash: 8,
        price: 150,
      },
    ],
    current: { pe: 12, pb: 2.5, evEbitda: 8 },
  });
  assert(h.points.length === 3, "3 points");
  assert(h.points[0].pe === 10, "2023 PE=10");
  assert(h.pe.median3y != null, "has 3y median PE");
  assert(h.premiumDiscount.peVsMedian3y != null, "premium ratio");
}

console.log("\n=== Peers ===");
{
  const p = buildPeerComparison({
    symbol: "FPT",
    sector: "Công nghệ",
    subject: {
      symbol: "FPT",
      pe: 20,
      pb: 4,
      ps: 3,
      evEbitda: 12,
      pfcf: 15,
      dividendYield: null,
      marketCap: 1e12,
    },
    peers: [
      {
        symbol: "CMG",
        pe: 18,
        pb: 3,
        ps: 2,
        evEbitda: 10,
        pfcf: 14,
        dividendYield: null,
        marketCap: 1e11,
      },
      {
        symbol: "ELC",
        pe: 22,
        pb: 5,
        ps: 4,
        evEbitda: 14,
        pfcf: 16,
        dividendYield: null,
        marketCap: 5e10,
      },
    ],
  });
  assert(p.industry.sampleSize === 2, "sample 2");
  assert(p.industry.peMedian === 20, "peer PE median 20");
  assert(p.relative.peVsMedian === 1, "subject at median");
}

console.log("\n=== Phase2 aggregate ===");
{
  const r = buildPhase2Valuation({
    marketCap: 1e12,
    enterpriseValue: 1.1e12,
    ocfTtm: 8e10,
    capexTtm: 2e10,
    fcfTtm: 6e10,
    ebitTtm: 9e10,
    taxRate: 0.2,
    daTtm: 1e10,
    deltaNwc: 5e9,
    netIncomeTtm: 5e10,
    netBorrowing: 0,
  });
  assert(r.cashFlow.pfcf.status === "ok", "pfcf ok");
  assert(r.cashFlow.fcff.status === "ok", "fcff ok");
  assert(r.valuationEngineVersion.includes("phase2"), "version phase2");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
