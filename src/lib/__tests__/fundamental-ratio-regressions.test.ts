import { computeFinancialHealth } from "../engines/fundamental";
import { buildTtmPeriod } from "../financial/normalize";
import { computeDetailedRatios, pickMetricsFromPeriods } from "../financial/ratio-engine";
import { buildSnapshotFromBundle } from "../financial/snapshots";
import type { FinancialPackage, GrowthSnapshot, NormalizedPeriod } from "../financial/types";
import type { FinancialHealthResult } from "../engines/fundamental";

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

const quarters: NormalizedPeriod[] = [];
for (const [year, quarter, revenue] of [
  [2024, 1, 10], [2024, 2, 15], [2024, 3, 15], [2024, 4, 20],
  [2025, 1, 20], [2025, 2, 25], [2025, 3, 25], [2025, 4, 30],
] as const) {
  quarters.push({
    period: `Q${quarter}-${year}`,
    periodType: "quarter",
    fiscalDate: null,
    year,
    quarter,
    statementScope: "consolidated",
    auditStatus: "unknown",
    currency: "VND",
    source: "test",
    unit: "VND",
    confidence: 1,
    metrics: { revenue, netIncome: revenue / 10 },
  });
}

console.log("\n=== Period comparison regressions ===");
{
  const currentTtm = buildTtmPeriod(quarters.slice(4));
  const newestFirst = [...quarters].reverse();
  const picked = pickMetricsFromPeriods(currentTtm ? [currentTtm, ...newestFirst] : newestFirst);
  const ratios = computeDetailedRatios({
    metrics: picked.metrics,
    prior: picked.prior,
    priceQuote: 10,
    sharesOutstanding: 100,
  });
  const growth = ratios.flat.find((x) => x.key === "revGrowth")?.value;
  assert(growth != null && Math.abs(growth - 2 / 3) < 1e-9, "TTM revenue compares to prior-year TTM (66.7%), not latest quarter");

  const quarterOnly = pickMetricsFromPeriods(newestFirst);
  const qRatios = computeDetailedRatios({
    metrics: quarterOnly.metrics,
    prior: quarterOnly.prior,
    priceQuote: 10,
    sharesOutstanding: 100,
  });
  assert(qRatios.flat.find((x) => x.key === "revGrowth")?.value === 0.5, "quarter growth compares with same fiscal quarter last year");

  const averageBalanceRatios = computeDetailedRatios({
    metrics: { netRevenue: 300, netIncome: 20, totalAssets: 200, equity: 100 },
    prior: { totalAssets: 100, equity: 80 },
    priceQuote: null,
    sharesOutstanding: null,
  });
  assert(Math.abs(averageBalanceRatios.flat.find((x) => x.key === "roa")!.value! - 20 / 150) < 1e-9,
    "ROA uses average assets when prior balance is available");
  assert(Math.abs(averageBalanceRatios.flat.find((x) => x.key === "roe")!.value! - 20 / 90) < 1e-9,
    "ROE uses average equity when prior balance is available");
  assert(averageBalanceRatios.flat.find((x) => x.key === "assetTurnover")?.value === 2,
    "asset turnover uses average assets");

  const incompleteQuickRatio = computeDetailedRatios({
    metrics: { currentAssets: 80, currentLiabilities: 40, cash: 20 },
    priceQuote: null,
    sharesOutstanding: null,
  });
  assert(incompleteQuickRatio.flat.find((x) => x.key === "quickRatio")?.value == null,
    "quick ratio stays unavailable if both current asset breakdown inputs are incomplete");
}

console.log("\n=== Missing financial components ===");
{
  const periodRows = (values: Record<string, number | string>[]) => values;
  const health = computeFinancialHealth({
    income: periodRows([
      { year: 2024, periodType: "year", revenue: 100, netProfit: 12, ebit: 15, ebitda: 18 },
    ]),
    balance: periodRows([
      { year: 2024, periodType: "year", totalAssets: 200, equity: 100, shortTermDebt: 30, cash: 10,
        currentAssets: 80, currentLiabilities: 40 },
    ]),
    cashflow: [],
  });
  assert(health.anchors.totalDebt == null, "one missing debt bucket is not assumed to be zero");
  assert(health.groups.leverage.netDebtToEbitda == null, "net debt/EBITDA stays null without complete debt");
  assert(health.groups.liquidity.quickRatio == null, "quick ratio does not assume missing inventory is zero");
  assert(health.warnings.some((x) => x.includes("cấu phần nợ")), "missing debt bucket is disclosed");

  const sparse = computeFinancialHealth({
    income: [{ year: 2024, periodType: "year", revenue: 100, grossProfit: 50, netProfit: 15, ebit: 18 }],
    balance: [{ year: 2024, periodType: "year", totalAssets: 200, equity: 100 }],
    cashflow: [],
  }, { symbol: "ZZZ" });
  assert(sparse.scores.overall != null && sparse.scores.overall > 70,
    "available score dimensions are renormalized instead of treating missing groups as zero");
}

console.log("\n=== Growth unit conversion ===");
{
  const growth: GrowthSnapshot = {
    yoy: [{ metric: "revenue", current: 500, prior: 100, changePct: 4, currentPeriod: "Q4-2025", priorPeriod: "Q4-2024" }],
    qoq: [], latestPeriod: "Q4-2025", priorYearPeriod: "Q4-2024", priorQuarterPeriod: null,
  };
  const bundle = {
    symbol: "AAA",
    pkg: { meta: { latestPeriod: "TTM-Q4-2025", qualityScore: 80 }, growth } as unknown as FinancialPackage,
    health: {
      groups: { profitability: {}, liquidity: {}, leverage: {}, cashflow: {}, efficiency: {} },
      scores: { overall: null }, coverage: 0, anchors: {},
    } as unknown as FinancialHealthResult,
    growth,
    qualityScore: 80,
  };
  const snapshot = buildSnapshotFromBundle(bundle);
  assert(snapshot.revenueYoyPct === 400, "a 4.0 growth ratio is converted to 400%, not 4%");
}

console.log("\n=== Distressed balance sheet & Negative EBITDA ===");
{
  const distressed = computeFinancialHealth({
    income: [{ year: 2024, periodType: "year", revenue: 100, grossProfit: 10, netProfit: -50, ebit: -40, ebitda: -30 }],
    balance: [{ year: 2024, periodType: "year", totalAssets: 100, equity: -20, shortTermDebt: 30, longTermDebt: 40, cash: 5 }],
    cashflow: [],
  }, { symbol: "DISTRESSED" });

  // Debt/Equity is negative (-3.5), must NOT receive 90 points (safest). It should receive 10 points.
  assert(distressed.scores.leverage != null && distressed.scores.leverage <= 25,
    "negative equity receives high leverage risk penalty (<=25), not 90");
  assert(distressed.groups.leverage.netDebtToEbitda == null,
    "negative EBITDA leaves net debt/EBITDA as null, not false negative multiple");
  assert(distressed.riskFlags.some((f) => f.includes("Vốn chủ sở hữu âm")),
    "negative equity produces an explicit insolvency risk flag");
  assert(distressed.riskFlags.some((f) => f.includes("EBITDA âm")),
    "negative EBITDA with net debt produces an operating debt service risk flag");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
