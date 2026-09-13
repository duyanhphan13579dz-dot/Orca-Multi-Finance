/**
 * Phase 1 valuation formula tests — pure functions, no network.
 * Run: node --import tsx src/lib/__tests__/valuation-phase1.test.ts
 */
import {
  calcMarketCap,
  calcPE,
  calcPB,
  calcPS,
  calcEnterpriseValue,
  calcEvEbitda,
  calcEvSales,
  calcEarningsYield,
  buildPhase1Valuation,
  scorePhase1DataQuality,
} from "../engines/valuation-phase1";

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

function approx(a: number | null, b: number, tol = 1e-6) {
  return a != null && Math.abs(a - b) <= tol;
}

console.log("\n=== Market Cap ===");
{
  const ok = calcMarketCap(100_000, 1_000_000);
  assert(ok.status === "ok" && ok.value === 100_000_000_000, "price × shares");
  assert(calcMarketCap(null, 1e6).status === "incomplete", "missing price");
  assert(calcMarketCap(100, 0).status === "incomplete", "zero shares");
  assert(calcMarketCap(-1, 1e6).status === "incomplete", "negative price");
}

console.log("\n=== P/E ===");
{
  const pe = calcPE({ price: 100_000, epsTtm: 10_000, marketCap: null, netIncomeTtm: null });
  assert(pe.status === "ok" && approx(pe.value, 10), "price / EPS = 10");
  const peNi = calcPE({
    price: null,
    epsTtm: null,
    marketCap: 1_000_000_000,
    netIncomeTtm: 50_000_000,
  });
  assert(peNi.status === "ok" && approx(peNi.value, 20), "MC / NI = 20");
  assert(
    calcPE({ price: 100, epsTtm: -5, marketCap: null, netIncomeTtm: null }).status === "not_applicable",
    "negative EPS → N/A",
  );
  assert(
    calcPE({ price: null, epsTtm: null, marketCap: null, netIncomeTtm: null }).status === "incomplete",
    "missing inputs",
  );
}

console.log("\n=== Earnings Yield ===");
{
  const y = calcEarningsYield({
    price: 100_000,
    epsTtm: 10_000,
    marketCap: null,
    netIncomeTtm: null,
  });
  assert(y.status === "ok" && approx(y.value, 0.1), "EPS/Price = 10%");
}

console.log("\n=== P/B ===");
{
  const pb = calcPB({
    price: 50_000,
    bvps: 25_000,
    equity: null,
    shares: null,
    marketCap: null,
  });
  assert(pb.status === "ok" && approx(pb.value, 2), "price / BVPS = 2");
  const pb2 = calcPB({
    price: 50_000,
    bvps: null,
    equity: 500_000_000,
    shares: 10_000,
    marketCap: null,
  });
  assert(pb2.status === "ok" && approx(pb2.value, 1), "price / (equity/shares)");
  assert(
    calcPB({ price: 10, bvps: null, equity: -100, shares: 10, marketCap: null }).status ===
      "not_applicable",
    "negative equity → N/A",
  );
}

console.log("\n=== P/S ===");
{
  const ps = calcPS({ marketCap: 1_000_000_000, revenueTtm: 500_000_000 });
  assert(ps.status === "ok" && approx(ps.value, 2), "MC / Revenue = 2");
  assert(calcPS({ marketCap: null, revenueTtm: 1 }).status === "incomplete", "missing MC");
  assert(calcPS({ marketCap: 1e9, revenueTtm: 0 }).status === "not_applicable", "zero revenue → N/A");
}

console.log("\n=== Enterprise Value ===");
{
  const full = calcEnterpriseValue({
    marketCap: 1_000,
    totalDebt: 200,
    cash: 50,
    minorityInterest: 10,
    preferredEquity: 0,
    nonOperatingInvestments: 5,
  });
  assert(full.cell.status === "ok" && approx(full.cell.value, 1155), "full EV components");
  assert(!full.components.incomplete, "complete components");

  const noCash = calcEnterpriseValue({ marketCap: 1_000, totalDebt: 200, cash: null });
  assert(noCash.cell.status === "incomplete", "missing cash → incomplete");
  assert(noCash.cell.value === 1200, "still computes with cash=0 fallback");
  assert(noCash.components.missing.includes("cash"), "reports missing cash");

  const noMc = calcEnterpriseValue({ marketCap: null, totalDebt: 100, cash: 10 });
  assert(noMc.cell.status === "incomplete" && noMc.cell.value == null, "no MC → no EV");
}

console.log("\n=== EV/EBITDA & EV/Sales ===");
{
  assert(
    calcEvEbitda(1155, 100).status === "ok" && approx(calcEvEbitda(1155, 100).value, 11.55),
    "EV/EBITDA",
  );
  assert(calcEvEbitda(1000, -10).status === "not_applicable", "neg EBITDA");
  assert(calcEvEbitda(null, 100).status === "incomplete", "missing EV");
  assert(calcEvSales(1000, 500).status === "ok" && approx(calcEvSales(1000, 500).value, 2), "EV/Sales");
}

console.log("\n=== buildPhase1Valuation integration ===");
{
  const r = buildPhase1Valuation({
    price: 100_000,
    shares: 1_000_000,
    netIncomeTtm: 50_000_000_000,
    epsTtm: 50_000,
    equity: 400_000_000_000,
    revenueTtm: 200_000_000_000,
    ebitdaTtm: 80_000_000_000,
    totalDebt: 50_000_000_000,
    cash: 20_000_000_000,
    source: "test",
  });
  assert(r.multiples.pe.status === "ok" && approx(r.multiples.pe.value, 2), "integrated P/E");
  assert(r.multiples.pb.status === "ok", "integrated P/B");
  assert(r.multiples.ps.status === "ok", "integrated P/S");
  assert(r.multiples.evEbitda.status === "ok", "integrated EV/EBITDA");
  assert(r.dataQuality === 100, "full data quality");
  assert(r.valuationEngineVersion.startsWith("2.0.0"), "engine version");
  assert(!Number.isNaN(r.multiples.marketCap.value as number), "no NaN");
}

console.log("\n=== Edge: empty inputs ===");
{
  const empty = buildPhase1Valuation({
    price: null,
    shares: null,
    netIncomeTtm: null,
    epsTtm: null,
    equity: null,
    revenueTtm: null,
    ebitdaTtm: null,
    totalDebt: null,
    cash: null,
  });
  assert(empty.multiples.pe.value == null, "no invented P/E");
  assert(empty.multiples.enterpriseValue.value == null, "no invented EV");
  assert(empty.dataQuality === 0, "zero quality");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
