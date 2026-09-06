import test from "node:test";
import assert from "node:assert/strict";
import { parseAmounts, parseBudgetQuestion } from "../finance/budget-parser";
import { computeBudgetPlan } from "../finance/financial-math";
import { executeTool } from "../agents/tools";
import { runBudgetPlanner, looksLikeBudgetQuestion } from "../agents/personal-finance";
import { classifyFinancial, runFinancialOrchestrator } from "../agents/orchestrator";

/* ------------------------------ amount parsing ----------------------------- */

test("budget: parseAmounts hiểu tiền Việt", () => {
  assert.deepEqual(
    parseAmounts("500k, 50k, 1,5 triệu, 2 tỷ"),
    [
      { raw: "500k", value: 500_000 },
      { raw: "50k", value: 50_000 },
      { raw: "1,5 triệu", value: 1_500_000 },
      { raw: "2 tỷ", value: 2_000_000_000 },
    ],
  );
  assert.deepEqual(parseAmounts("500.000đ"), [{ raw: "500.000đ", value: 500_000 }]);
  assert.deepEqual(parseAmounts("2 tuần"), []); // không có hậu tố tiền tệ → không phải tiền
});

/* --------------------------- question extraction --------------------------- */

test("budget: parseBudgetQuestion trích đúng câu screenshot", () => {
  const p = parseBudgetQuestion("Tôi còn 500k tiêu trong 2 tuần thì phân chia như nào? Biết 1 tuần tôi đó xăng hết 50k, ăn quán hết 50k");
  assert.equal(p.totalAmount, 500_000);
  assert.equal(p.weeks, 2);
  assert.equal(p.fixedExpenses.length, 2);
  const xang = p.fixedExpenses.find((f) => f.label === "Xăng")!;
  assert.equal(xang.amount, 50_000);
  assert.equal(xang.per, "week");
  const an = p.fixedExpenses.find((f) => f.label === "Ăn uống")!;
  assert.equal(an.amount, 50_000);
  assert.equal(an.per, "week");
});

test("budget: parseBudgetQuestion không đoán khi thiếu số tiền", () => {
  const p = parseBudgetQuestion("làm sao để tiết kiệm hơn?");
  assert.equal(p.totalAmount, null);
  assert.equal(p.weeks, null);
  assert.equal(p.fixedExpenses.length, 0);
});

/* ------------------------------ budget engine ------------------------------ */

test("budget: computeBudgetPlan 500k/2 tuần + 50k xăng + 50k ăn mỗi tuần", () => {
  const plan = computeBudgetPlan(500_000, 2, [
    { label: "Xăng", amount: 50_000, per: "week" },
    { label: "Ăn uống", amount: 50_000, per: "week" },
  ]);
  assert.ok(plan);
  assert.equal(plan.weeklyBudget, 250_000);
  assert.equal(plan.fixedWeekly, 100_000);
  assert.equal(plan.discretionaryWeekly, 150_000);
  assert.equal(plan.deficit, null);
  assert.equal(plan.suggestedSplit.length, 3);
  assert.equal(plan.suggestedSplit[0].weekly, 75_000); // 50% của 150k
});

test("budget: computeBudgetPlan thiếu hụt → deficit, không âm giả", () => {
  const plan = computeBudgetPlan(200_000, 1, [{ label: "Ăn uống", amount: 300_000, per: "week" }]);
  assert.ok(plan);
  assert.equal(plan.discretionaryWeekly, -100_000);
  assert.equal(plan.deficit, 100_000);
});

test("budget: computeBudgetPlan input sai → null", () => {
  assert.equal(computeBudgetPlan(0, 2, []), null);
  assert.equal(computeBudgetPlan(500_000, 0, []), null);
});

/* --------------------------------- tool ------------------------------------ */

test("budget tool: budget_plan trả structured plan", async () => {
  const r = await executeTool("budget_plan", {
    totalAmount: 500_000,
    weeks: 2,
    fixedExpenses: [
      { label: "Xăng", amount: 50_000, per: "week" },
      { label: "Ăn uống", amount: 50_000, per: "week" },
    ],
  });
  assert.equal(r.ok, true);
  const d = r.data as { weeklyBudget: number; discretionaryWeekly: number; fixedWeekly: number };
  assert.equal(d.weeklyBudget, 250_000);
  assert.equal(d.fixedWeekly, 100_000);
  assert.equal(d.discretionaryWeekly, 150_000);
  // không cần profile (dữ liệu từ câu hỏi, không lưu memory)
  const r2 = await executeTool("budget_plan", { totalAmount: 500_000, weeks: 2 }, {});
  assert.equal(r2.ok, true);
});

/* ------------------------------ agent + routing ---------------------------- */

test("budget agent: runBudgetPlanner trả kế hoạch đúng câu screenshot", async () => {
  const run = await runBudgetPlanner("Tôi còn 500k tiêu trong 2 tuần thì phân chia như nào? Biết 1 tuần tôi đó xăng hết 50k, ăn quán hết 50k");
  assert.equal(run.agent, "personal-finance");
  const ids = run.sections.map((s) => s.id);
  assert.ok(ids.includes("budget-input"));
  assert.ok(ids.includes("budget-fixed"));
  assert.ok(ids.includes("budget-split"));
  assert.ok(run.narrative.includes("250.000")); // 500k/2 tuần
  assert.ok(run.narrative.includes("150.000")); // còn lại mỗi tuần
  // không bao giờ trả nội dung thị trường
  assert.ok(!run.narrative.includes("VN-Index") && !run.narrative.includes("BTC"));
});

test("budget routing: classifyFinancial nhận diện câu ngân sách", () => {
  const cls = classifyFinancial("Tôi còn 500k tiêu trong 2 tuần thì phân chia như nào? Biết 1 tuần tôi đó xăng hết 50k, ăn quán hết 50k");
  assert.deepEqual(cls, { intents: ["personal-finance"], kind: "budget-plan" });
  assert.equal(looksLikeBudgetQuestion("Phân tích HPG"), false); // không lẫn stock
  assert.equal(looksLikeBudgetQuestion("thị trường hôm nay thế nào"), false); // không lẫn market
});

test("budget orchestrator: e2e trả kế hoạch ngân sách, không rơi về pipeline thị trường", async () => {
  const { result } = await runFinancialOrchestrator("Tôi còn 500k tiêu trong 2 tuần thì phân chia như nào? Biết 1 tuần tôi đó xăng hết 50k, ăn quán hết 50k", { depth: "standard" });
  const r = result as { intent: string; answer: string; agents: string[] };
  assert.equal(r.intent, "financial:budget-plan");
  assert.deepEqual(r.agents, ["personal-finance"]);
  assert.ok(r.answer.includes("250.000"));
  assert.ok(r.answer.includes("500.000"));
  assert.ok(!r.answer.includes("Thị trường phân hóa"));
});

test("budget routing: số tiền + từ khóa là điều kiện bắt buộc", () => {
  assert.equal(classifyFinancial("phân chia tiền thế nào?").intents.length, 0); // không số
  assert.equal(classifyFinancial("100k là bao nhiêu đô?").kind, "unknown"); // không từ khóa tiêu
});
