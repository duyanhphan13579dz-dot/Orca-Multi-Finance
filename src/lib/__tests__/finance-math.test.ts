import test from "node:test";
import assert from "node:assert/strict";
import {
  computeAssetAllocation,
  computeCashFlow,
  computeConcentration,
  computeCurrencyExposure,
  computeDebtToIncome,
  computeEmergencyFundCoverage,
  computeFinancialHealth,
  computeGoalProgress,
  computeLiquidityRatio,
  computeLeverageRatio,
  computeMaxDrawdown,
  computeNetWorth,
  computePortfolioReturn,
  computePortfolioRiskProxy,
  computeSavingsRate,
  computeSectorExposure,
  projectGoal,
  requiredMonthlySaving,
  runPortfolioScenario,
} from "../finance/financial-math";

/* ------------------------- cash flow & net worth -------------------------- */

test("financial-math: cash flow tính free cash flow", () => {
  const r = computeCashFlow(30_000_000, 20_000_000);
  assert.deepEqual(r, { income: 30_000_000, expenses: 20_000_000, freeCashFlow: 10_000_000 });
});

test("financial-math: thiếu 1 vế → null, không đoán", () => {
  assert.equal(computeCashFlow(30_000_000, null).freeCashFlow, null);
  const empty = computeCashFlow(null, null);
  assert.equal(empty.income, null);
  assert.equal(empty.freeCashFlow, null);
});

test("financial-math: net worth = assets − liabilities", () => {
  assert.equal(computeNetWorth(500_000_000, 100_000_000).netWorth, 400_000_000);
});

test("financial-math: nợ > tài sản → net worth âm (hợp lệ)", () => {
  assert.equal(computeNetWorth(100_000_000, 150_000_000).netWorth, -50_000_000);
});

/* --------------------------------- ratios --------------------------------- */

test("financial-math: savings rate = FCF / gross income", () => {
  assert.ok(Math.abs((computeSavingsRate(10_000_000, 40_000_000) ?? 0) - 0.25) < 1e-9);
});

test("financial-math: DTI = debt / income", () => {
  assert.ok(Math.abs((computeDebtToIncome(8_000_000, 40_000_000) ?? 0) - 0.2) < 1e-9);
});

test("financial-math: emergency fund = liquid / expenses", () => {
  assert.equal(computeEmergencyFundCoverage(120_000_000, 20_000_000), 6);
});

test("financial-math: liquidity = liquid / total assets", () => {
  assert.ok(Math.abs((computeLiquidityRatio(150_000_000, 500_000_000) ?? 0) - 0.3) < 1e-9);
});

test("financial-math: leverage = liabilities / assets", () => {
  assert.ok(Math.abs((computeLeverageRatio(200_000_000, 500_000_000) ?? 0) - 0.4) < 1e-9);
});

/* ----------------------------- health score ------------------------------- */

test("financial-math: tài chính lành mạnh → STRONG", () => {
  const h = computeFinancialHealth({
    monthlyIncome: 50_000_000,
    monthlyExpenses: 25_000_000,
    monthlyDebtPayments: 5_000_000,
    liquidAssets: 300_000_000,
    totalAssets: 1_000_000_000,
    totalLiabilities: 200_000_000,
  });
  assert.equal(h.level, "STRONG");
  assert.ok((h.overall ?? 0) >= 75);
  assert.equal(h.metrics.savingsRate.status, "GOOD");
  assert.equal(h.metrics.emergencyFund.value, 12);
});

test("financial-math: thiếu thu nhập → metric UNAVAILABLE, vẫn tính được metric khác", () => {
  const h = computeFinancialHealth({
    monthlyIncome: null,
    monthlyExpenses: 25_000_000,
    monthlyDebtPayments: null,
    liquidAssets: 300_000_000,
    totalAssets: 1_000_000_000,
    totalLiabilities: null,
  });
  assert.equal(h.metrics.savingsRate.status, "UNAVAILABLE");
  assert.equal(h.metrics.debtToIncome.status, "UNAVAILABLE");
  assert.equal(h.metrics.emergencyFund.value, 12);
  assert.notEqual(h.overall, null);
});

test("financial-math: không có dữ liệu → UNAVAILABLE, không phạt 0", () => {
  const h = computeFinancialHealth({
    monthlyIncome: null,
    monthlyExpenses: null,
    monthlyDebtPayments: null,
    liquidAssets: null,
    totalAssets: null,
    totalLiabilities: null,
  });
  assert.equal(h.overall, null);
  assert.equal(h.level, "UNAVAILABLE");
  const savings = h.metrics.savingsRate;
  assert.equal(savings.status, "UNAVAILABLE");
  assert.equal(savings.score, null);
});

test("financial-math: nợ cao → POOR", () => {
  const h = computeFinancialHealth({
    monthlyIncome: 20_000_000,
    monthlyExpenses: 15_000_000,
    monthlyDebtPayments: 12_000_000,
    liquidAssets: 5_000_000,
    totalAssets: 100_000_000,
    totalLiabilities: 90_000_000,
  });
  assert.equal(h.metrics.debtToIncome.status, "POOR");
  assert.equal(h.metrics.leverage.status, "POOR");
  assert.equal(h.level, "CRITICAL");
});

/* --------------------------------- goals ---------------------------------- */

test("financial-math: projectGoal có lãi kép, không đoán khi thiếu input", () => {
  const r = projectGoal(100_000_000, 5_000_000, 8, 10);
  if (!r) throw new Error("projectGoal should not be null");
  assert.ok(r.futureValue > r.contributed);
  assert.ok(r.growth > 0);
  assert.equal(projectGoal(null, null, 8, 10), null);
});

test("financial-math: requiredMonthlySaving hợp lý cho mục tiêu 1 tỷ/10 năm @8%", () => {
  const r = requiredMonthlySaving(1_000_000_000, 0, 8, 10);
  if (!r) throw new Error("requiredMonthlySaving should not be null");
  assert.ok(r.monthly > 4_000_000 && r.monthly < 7_000_000);
});

test("financial-math: đã đủ tiền → monthly = 0", () => {
  const r = requiredMonthlySaving(100_000_000, 200_000_000, 8, 5);
  assert.deepEqual(r, { monthly: 0, totalContribution: 0 });
});

test("financial-math: goal progress", () => {
  assert.ok(Math.abs((computeGoalProgress(50_000_000, 200_000_000) ?? 0) - 0.25) < 1e-9);
  assert.equal(computeGoalProgress(null, 200_000_000), null);
});

/* ------------------------------- portfolio -------------------------------- */

const holdings = [
  { id: "a", label: "Tiền mặt", assetClass: "cash", value: 100_000_000, currency: "VND" },
  { id: "b", label: "HPG", assetClass: "stocks", value: 300_000_000, sector: "Vật liệu", currency: "VND" },
  { id: "c", label: "VNM", assetClass: "stocks", value: 200_000_000, sector: "Tiêu dùng", currency: "VND" },
  { id: "d", label: "Vàng", assetClass: "gold", value: 400_000_000, currency: "VND" },
];

test("financial-math: asset allocation tổng + trọng số", () => {
  const r = computeAssetAllocation(holdings);
  if (!r) throw new Error("asset allocation should not be null");
  assert.equal(r.total, 1_000_000_000);
  const gold = r.rows.find((x) => x.key === "gold");
  if (!gold) throw new Error("gold row missing");
  assert.ok(Math.abs(gold.weightPct - 40) < 1e-9);
  const stocks = r.rows.find((x) => x.key === "stocks");
  if (!stocks) throw new Error("stocks row missing");
  assert.ok(Math.abs(stocks.weightPct - 50) < 1e-9);
});

test("financial-math: concentration 4 tài sản cân bằng → MODERATE, HHI hợp lệ", () => {
  const c = computeConcentration(holdings);
  // weights 10/30/20/40 → HHI = 3000, top1 = 40%
  assert.equal(c.hhi, 3000);
  assert.equal(c.level, "MODERATE");
  assert.equal(c.largest?.label, "Vàng");
  assert.ok(Math.abs((c.largest?.weightPct ?? 0) - 40) < 1e-9);
});

test("financial-math: concentration 1 tài sản 80% → CONCENTRATED", () => {
  const c = computeConcentration([
    { id: "x", label: "BĐS", assetClass: "realEstate", value: 800_000_000 },
    { id: "y", label: "Tiền mặt", assetClass: "cash", value: 200_000_000 },
  ]);
  assert.equal(c.level, "CONCENTRATED");
});

test("financial-math: sector exposure chỉ tính holdings có sector", () => {
  const r = computeSectorExposure(holdings);
  if (!r) throw new Error("sector exposure should not be null");
  assert.equal(r.total, 500_000_000);
  const vatLieu = r.rows.find((x) => x.sector === "Vật liệu");
  if (!vatLieu) throw new Error("Vật liệu row missing");
  assert.ok(Math.abs(vatLieu.weightPct - 60) < 1e-9);
});

test("financial-math: currency exposure", () => {
  const r = computeCurrencyExposure(holdings);
  if (!r) throw new Error("currency exposure should not be null");
  assert.equal(r.rows.length, 1);
  assert.ok(Math.abs(r.rows[0].weightPct - 100) < 1e-9);
});

test("financial-math: portfolio return có trọng số; thiếu return → null", () => {
  const r = computePortfolioReturn([
    { value: 100, returnPct: 10 },
    { value: 300, returnPct: -5 },
  ]);
  assert.ok(Math.abs((r.weightedReturnPct ?? 0) - -1.25) < 1e-9);
  const r2 = computePortfolioReturn([{ value: 100, returnPct: null }]);
  assert.equal(r2.weightedReturnPct, null);
  assert.equal(r2.missing, 1);
});

test("financial-math: portfolio risk proxy là cận trên; thiếu vol → null", () => {
  const r = computePortfolioRiskProxy([
    { value: 100, volatilityPct: 20 },
    { value: 300, volatilityPct: 30 },
  ]);
  assert.ok(Math.abs((r.worstCaseVolPct ?? 0) - 27.5) < 1e-9);
  const r2 = computePortfolioRiskProxy([{ value: 100, volatilityPct: null }]);
  assert.equal(r2.worstCaseVolPct, null);
});

test("financial-math: max drawdown từ chuỗi giá", () => {
  const dd = computeMaxDrawdown([100, 120, 90, 110, 80, 100]);
  assert.ok(Math.abs((dd ?? 0) - (120 - 80) / 120) < 1e-9);
  assert.equal(computeMaxDrawdown([100]), null);
});

test("financial-math: scenario shock cổ phiếu -10%, vàng +5%", () => {
  const r = runPortfolioScenario(holdings, [
    { assetClass: "stocks", shockPct: -10 },
    { assetClass: "gold", shockPct: 5 },
  ]);
  if (!r) throw new Error("scenario should not be null");
  assert.ok(Math.abs((r.changePct ?? 0) - -3) < 1e-9);
});
