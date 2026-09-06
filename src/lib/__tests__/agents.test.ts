import test from "node:test";
import assert from "node:assert/strict";
import { buildFinancialProfile } from "../finance/financial-profile";
import { runPersonalFinance, healthPlan } from "../agents/personal-finance";
import { runWealthManager } from "../agents/wealth-manager";
import { classifyFinancial, runFinancialOrchestrator } from "../agents/orchestrator";
import { extractStockSymbol } from "../agents/stock-analyst";

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
  goals: [{ id: "retire", name: "Nghỉ hưu", targetAmount: 2_000_000_000, currentAmount: 500_000_000, monthlyContribution: 5_000_000, annualReturnPct: 8, targetYear: new Date().getFullYear() + 20 }],
});

test("agents: personal-finance không profile → DATA_UNAVAILABLE trung thực", async () => {
  const run = await runPersonalFinance({});
  assert.equal(run.sections[0].unavailable, true);
  assert.equal(run.unavailable.includes("profile"), true);
});

test("agents: personal-finance có profile → health + action plan", async () => {
  const run = await runPersonalFinance({ profile });
  assert.equal(run.agent, "personal-finance");
  const ids = run.sections.map((s) => s.id);
  assert.ok(ids.includes("health"));
  assert.ok(ids.includes("action-plan"));
  const health = run.sections.find((s) => s.id === "health")!;
  assert.ok((health.data as { level: string }).level === "STRONG");
  assert.ok(run.sections.find((s) => s.id === "action-plan")!.body.includes("Duy trì"));
});

test("agents: healthPlan ưu tiên đúng khi quỹ khẩn cấp thiếu", () => {
  const poor = buildFinancialProfile({ monthlyIncome: 20_000_000, monthlyExpenses: 18_000_000, liquidAssets: 5_000_000 });
  const plans = healthPlan(poor);
  assert.equal(plans[0].priority, "HIGH");
  assert.ok(plans[0].action.includes("khẩn cấp") || plans[0].action.includes("Quỹ"));
});

test("agents: wealth-manager có profile → allocation + concentration + rebalancing", async () => {
  const run = await runWealthManager({ profile });
  assert.equal(run.agent, "wealth-manager");
  const ids = run.sections.map((s) => s.id);
  for (const id of ["portfolio", "allocation", "concentration", "rebalancing"]) assert.ok(ids.includes(id), `thiếu section ${id}`);
  const rebal = run.sections.find((s) => s.id === "rebalancing")!;
  assert.equal(rebal.label, "MODEL-INFERENCE");
  assert.ok(rebal.body.includes("model inference"));
});

test("orchestrator: classifyFinancial phân loại đúng intent", () => {
  assert.deepEqual(classifyFinancial("Phân tích cổ phiếu HPG"), { intents: ["stock-analyst"], symbol: "HPG", kind: "stock-analysis" });
  const multi = classifyFinancial("500 triệu mua HPG có đáng không?");
  assert.deepEqual(multi.intents, ["stock-analyst", "wealth-manager", "personal-finance"]);
  assert.equal(multi.symbol, "HPG");
  assert.deepEqual(classifyFinancial("kiểm tra sức khỏe tài chính của tôi"), { intents: ["personal-finance"], kind: "personal-finance" });
  assert.deepEqual(classifyFinancial("danh mục của tôi có quá tập trung không?"), { intents: ["wealth-manager"], kind: "wealth" });
  assert.deepEqual(classifyFinancial("thị trường hôm nay thế nào"), { intents: [], kind: "unknown" });
});

test("orchestrator: extractStockSymbol nhận diện mã VN", () => {
  assert.equal(extractStockSymbol("Phân tích HPG"), "HPG");
  assert.equal(extractStockSymbol("VNM đang thế nào?"), "VNM");
  assert.equal(extractStockSymbol("thị trường ra sao"), null);
});

test("orchestrator: intent legacy → delegate answerQuestion (hoạt động không crash)", async () => {
  const { result, meta } = await runFinancialOrchestrator("So sánh BTC và ETH", { depth: "concise" });
  // legacy pipeline giữ nguyên shape
  assert.ok(result.answer !== undefined || (result as { intent?: string }).intent);
  assert.ok(meta.freshness);
});

test("orchestrator: intent personal-finance → agents array + trace", async () => {
  const { result } = await runFinancialOrchestrator("sức khỏe tài chính của tôi thế nào", {}, { profileOverride: profile });
  assert.equal((result as { intent: string }).intent, "financial:personal-finance");
  assert.deepEqual((result as { agents: string[] }).agents, ["personal-finance"]);
  assert.ok((result as { sections: unknown[] }).sections.length > 0);
});
