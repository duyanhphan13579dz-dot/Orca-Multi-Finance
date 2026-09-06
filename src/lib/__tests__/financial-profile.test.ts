import test from "node:test";
import assert from "node:assert/strict";
import { buildFinancialProfile } from "../finance/financial-profile";

test("financial-profile: profile đầy đủ → derive đúng mọi chỉ số", () => {
  const p = buildFinancialProfile({
    monthlyIncome: 50_000_000,
    monthlyExpenses: 25_000_000,
    monthlyDebtPayments: 5_000_000,
    liquidAssets: 300_000_000,
    totalAssets: 1_000_000_000,
    totalLiabilities: 200_000_000,
    emergencyTargetMonths: 6,
    riskProfile: "balanced",
    holdings: [
      { id: "cash", label: "Tiền mặt", assetClass: "cash", value: 100_000_000, currency: "VND" },
      { id: "hpg", label: "HPG", assetClass: "stocks", value: 300_000_000, sector: "Vật liệu", currency: "VND" },
      { id: "gold", label: "Vàng", assetClass: "gold", value: 300_000_000, currency: "VND" },
    ],
    goals: [
      { id: "retire", name: "Nghỉ hưu", targetAmount: 2_000_000_000, currentAmount: 500_000_000, monthlyContribution: 5_000_000, annualReturnPct: 8, targetYear: new Date().getFullYear() + 20 },
    ],
  });
  assert.equal(p.valid, true);
  assert.equal(p.completeness, 1);
  assert.equal(p.derive.cashFlow.freeCashFlow.value, 25_000_000);
  assert.equal(p.derive.netWorth.value.value, 800_000_000);
  assert.ok(Math.abs((p.derive.savingsRate.value ?? 0) - 0.5) < 1e-9);
  assert.ok(Math.abs((p.derive.debtToIncome.value ?? 0) - 0.1) < 1e-9);
  assert.equal(p.derive.emergencyFund.value, 12);
  assert.equal(p.derive.health.level, "STRONG");
  assert.equal(p.derive.allocation?.total, 700_000_000);
  assert.equal(p.derive.concentration.holdingsCount, 3);
  assert.equal(p.derive.goals.length, 1);
  const g = p.derive.goals[0];
  assert.ok(g.projectedValue.value! > g.goal.targetAmount);
  assert.equal(g.onTrack.value, true);
});

test("financial-profile: thiếu dữ liệu → available=false, không phạt 0", () => {
  const p = buildFinancialProfile({ monthlyIncome: null, monthlyExpenses: null });
  assert.equal(p.valid, true);
  assert.equal(p.completeness, 0);
  assert.equal(p.derive.health.level, "UNAVAILABLE");
  assert.equal(p.derive.savingsRate.available, false);
  assert.equal(p.derive.cashFlow.freeCashFlow.available, false);
});

test("financial-profile: field sai → bị loại + errors, không đoán", () => {
  const p = buildFinancialProfile({
    monthlyIncome: "abc",
    monthlyExpenses: -5,
    totalAssets: 100,
    emergencyTargetMonths: 200,
    riskProfile: "mega-risky" as never,
  });
  assert.equal(p.valid, false);
  assert.ok(p.errors.monthlyIncome);
  assert.ok(p.errors.monthlyExpenses);
  assert.ok(p.errors.emergencyTargetMonths);
  assert.ok(p.errors.riskProfile);
  // field lỗi bị loại khỏi inputs (null), field hợp lệ giữ nguyên
  assert.equal(p.inputs.monthlyIncome, null);
  assert.equal(p.inputs.monthlyExpenses, null);
  assert.equal(p.inputs.totalAssets, 100);
});

test("financial-profile: holdings không hợp lệ (value <= 0) bị loại", () => {
  const p = buildFinancialProfile({
    holdings: [
      { id: "ok", label: "Hợp lệ", assetClass: "cash", value: 10_000_000 },
      { id: "bad", label: "Sai", assetClass: "stocks", value: -1 },
      { id: "", label: "Thiếu id", assetClass: "stocks", value: 5_000_000 },
    ],
  });
  assert.equal(p.inputs.holdings.length, 1);
  assert.equal(p.inputs.holdings[0].id, "ok");
  assert.equal(p.derive.concentration.holdingsCount, 1);
  assert.ok(p.errors["holdings[1].value"]);
  assert.ok(p.errors["holdings[2]"]);
});

test("financial-profile: goal thiếu targetAmount bị loại", () => {
  const p = buildFinancialProfile({
    goals: [{ id: "g1", name: "Xe", targetAmount: 0, currentAmount: null, monthlyContribution: null, annualReturnPct: null, targetYear: null }],
  });
  assert.equal(p.inputs.goals.length, 0);
  assert.ok(p.errors["goals[0].targetAmount"]);
});
