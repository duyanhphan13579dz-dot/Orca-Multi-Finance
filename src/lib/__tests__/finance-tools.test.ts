import test from "node:test";
import assert from "node:assert/strict";
import { personalFinanceTools, wealthTools, scenarioTools } from "../agents/finance-tools";
import { executeTool, listTools, toolNamesIn } from "../agents/tools";
import { buildFinancialProfile } from "../finance/financial-profile";
import type { ToolContext } from "../agents/tool-types";

const profile = buildFinancialProfile({
  birthYear: 1990,
  monthlyIncome: 50_000_000,
  monthlyExpenses: 25_000_000,
  monthlyDebtPayments: 5_000_000,
  liquidAssets: 300_000_000,
  totalAssets: 1_000_000_000,
  totalLiabilities: 200_000_000,
  riskProfile: "balanced",
  holdings: [
    { id: "cash", label: "Tiền mặt", assetClass: "cash", value: 100_000_000, currency: "VND" },
    { id: "hpg", label: "HPG", assetClass: "stocks", value: 300_000_000, sector: "Vật liệu", currency: "VND" },
    { id: "gold", label: "Vàng", assetClass: "gold", value: 300_000_000, currency: "VND" },
  ],
  goals: [
    { id: "retire", name: "Nghỉ hưu", targetAmount: 2_000_000_000, currentAmount: 500_000_000, monthlyContribution: 5_000_000, annualReturnPct: 8, targetYear: new Date().getFullYear() + 20 },
    { id: "car", name: "Mua xe", targetAmount: 800_000_000, currentAmount: 0, monthlyContribution: null, annualReturnPct: 8, targetYear: new Date().getFullYear() + 5 },
  ],
});

const ctx: ToolContext = { profile };

test("tool layer: registry có đủ tool của 4 khối", () => {
  const names = listTools().map((t) => t.name);
  for (const expected of [
    "cash_flow", "net_worth", "savings_rate", "debt_to_income", "emergency_fund", "financial_health", "goal_progress", "required_monthly_saving",
    "get_portfolio", "portfolio_return", "portfolio_risk", "max_drawdown", "concentration", "sector_exposure", "asset_allocation", "currency_exposure", "rebalancing_plan",
    "financial_scenario", "portfolio_scenario", "goal_projection",
    "get_stock_quote", "get_stock_profile", "get_stock_financials", "get_stock_valuation", "get_stock_technicals", "get_stock_history", "get_stock_news", "get_stock_reports", "get_stock_recommendations",
    "market_context", "sector_context", "market_breadth", "commodity_quotes", "macro_fx_snapshot", "get_metal_quote", "get_vn_indices",
  ]) {
    assert.ok(names.includes(expected), `thiếu tool ${expected}`);
  }
  assert.ok(toolNamesIn(["personal-finance"]).includes("financial_health"));
  assert.ok(toolNamesIn(["portfolio"]).includes("rebalancing_plan"));
});

test("tool layer: executeTool không tồn tại → INVALID_INPUT", async () => {
  const r = await executeTool("khong_ton_tai", {});
  assert.equal(r.ok, false);
  assert.equal(r.code, "INVALID_INPUT");
});

test("tool layer: param required thiếu → INVALID_INPUT", async () => {
  const r = await executeTool("required_monthly_saving", {}, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.code, "INVALID_INPUT");
});

test("tool layer: tool needs profile, không có → CONSENT_REQUIRED", async () => {
  const r = await executeTool("financial_health", {}, {});
  assert.equal(r.ok, false);
  assert.equal(r.code, "CONSENT_REQUIRED");
});

test("personal finance tools: tính đúng từ profile", async () => {
  const savings = await executeTool("savings_rate", {}, ctx);
  assert.equal(savings.ok, true);
  assert.ok(Math.abs((savings.data as { pct: number }).pct - 50) < 1e-9);

  const health = await executeTool("financial_health", {}, ctx);
  assert.equal(health.ok, true);
  assert.equal((health.data as { level: string }).level, "STRONG");

  const ef = await executeTool("emergency_fund", {}, ctx);
  assert.equal((ef.data as { months: number }).months, 12);

  const g = await executeTool("goal_progress", { goalId: "retire" }, ctx);
  assert.equal((g.data as { goals: unknown[] }).goals.length, 1);

  // goal "retire" đã đủ tiền (current + lãi kép) → monthly = 0
  const req = await executeTool("required_monthly_saving", { goalId: "retire" }, ctx);
  assert.equal(req.ok, true);
  assert.equal((req.data as { monthly: number }).monthly, 0);
  // goal "car" chưa có gì → cần góp hàng tháng > 0
  const reqCar = await executeTool("required_monthly_saving", { goalId: "car" }, ctx);
  assert.equal(reqCar.ok, true);
  assert.ok((reqCar.data as { monthly: number }).monthly > 0);
});

test("wealth tools: allocation/concentration/rebalancing", async () => {
  const alloc = await executeTool("asset_allocation", {}, ctx);
  assert.equal(alloc.ok, true);
  const a = alloc.data as { total: number; rows: { key: string; weightPct: number }[] };
  assert.equal(a.total, 700_000_000);
  assert.equal(a.rows.length, 3);

  const conc = await executeTool("concentration", {}, ctx);
  assert.equal(conc.ok, true);
  assert.equal((conc.data as { level: string }).level, "MODERATE"); // top1 42.9% < 50%

  const rebal = await executeTool("rebalancing_plan", {}, ctx);
  assert.equal(rebal.ok, true);
  const rb = rebal.data as { suggested: { key: string; suggestedAction: string }[]; disclaimer: string };
  assert.equal(rb.suggested.length, 3);
  assert.ok(rb.disclaimer.includes("model inference"));

  const sector = await executeTool("sector_exposure", {}, ctx);
  assert.equal((sector.data as { rows: unknown[] }).rows.length, 1);
});

test("scenario tools: portfolio_scenario và goal_projection", async () => {
  const psc = await executeTool("portfolio_scenario", { shocks: [{ assetClass: "stocks", shockPct: -10 }, { assetClass: "gold", shockPct: 5 }] }, ctx);
  assert.equal(psc.ok, true);
  assert.ok(Math.abs((psc.data as { changePct: number }).changePct - ((300 * -0.1 + 300 * 0.05) / 700) * 100) < 1e-9);

  const proj = await executeTool("goal_projection", { goalId: "retire" }, ctx);
  assert.equal(proj.ok, true);
  const p = proj.data as { futureValue: number; reached: boolean };
  assert.ok(p.futureValue > 2_000_000_000);
  assert.equal(p.reached, true);

  const fsc = await executeTool("financial_scenario", { months: 6 }, ctx);
  assert.equal(fsc.ok, true);
  assert.equal((fsc.data as { coverageMonths: number }).coverageMonths, 12);
  assert.equal((fsc.data as { survival: boolean }).survival, true);
});

test("personal finance tools: không đăng ký nhầm domain", () => {
  const pfNames = personalFinanceTools.map((t) => t.spec.name);
  assert.ok(pfNames.includes("required_monthly_saving"));
  const wNames = wealthTools.map((t) => t.spec.name);
  assert.ok(wNames.includes("rebalancing_plan"));
  const sNames = scenarioTools.map((t) => t.spec.name);
  assert.ok(sNames.includes("portfolio_scenario"));
});
