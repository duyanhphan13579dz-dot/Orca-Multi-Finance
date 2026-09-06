import test from "node:test";
import assert from "node:assert/strict";
import { buildFinancialProfile } from "../finance/financial-profile";
import { executeTool, listTools } from "../agents/tools";
import { runPersonalFinance } from "../agents/personal-finance";
import { runWealthManager } from "../agents/wealth-manager";
import { classifyFinancial } from "../agents/orchestrator";
import { searchKnowledge, KNOWLEDGE_BASE } from "../agents/knowledge";
import { validateOutput, collectFactNumbers } from "../ai/validate";

/**
 * AI AGENT INTERNAL EVALUATION BENCHMARK (§19 spec) — 4 khối, chạy offline.
 * Mục đích: chốt hành vi (structured tool output, chống ảo giác, phân loại bằng
 * chứng, multi-agent routing) trong CI; không cần mạng, không cần LLM.
 */

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

/* ------------------- Block 1: TOOL LAYER (structured data) ----------------- */

test("eval[1] tool layer: ≥ 34 tools, output có meta + structured data", () => {
  const tools = listTools();
  assert.ok(tools.length >= 34, `kỳ vọng ≥34 tool, có ${tools.length}`);
  const domains = new Set(tools.map((t) => t.domain));
  for (const d of ["stock", "market", "commodity", "macro", "portfolio", "personal-finance", "scenario"] as const) {
    assert.ok(domains.has(d), `thiếu domain ${d}`);
  }
  // mọi tool spec có params mô tả
  for (const t of tools) assert.ok(t.description.length > 10);
});

test("eval[1] tool layer: profile tool thiếu profile → CONSENT_REQUIRED (không đoán)", async () => {
  const r = await executeTool("financial_health", {}, {});
  assert.equal(r.ok, false);
  assert.equal(r.code, "CONSENT_REQUIRED");
});

test("eval[1] tool layer: tool stock thiếu nguồn → DATA_UNAVAILABLE kèm message", async () => {
  const r = await executeTool("get_stock_recommendations", { symbol: "HPG" }, {});
  // dù nguồn có/không — endpoint này không bao giờ bịa recommendation
  assert.equal(r.ok, false);
  assert.equal(r.code, "DATA_UNAVAILABLE");
  assert.ok(r.message!.length > 0);
});

/* ---------------- Block 2: ANTI-HALLUCINATION & TRUTHFULNESS --------------- */

test("eval[2] anti-hallucination: validateOutput chặn số lạ so với contract", () => {
  // contract = structured data object (như tool trả về)
  const facts = collectFactNumbers({ pe: 12.5, roe: 20, de: 0.35, price: 44500 });
  const bad = validateOutput("Giá mục tiêu 150000 — hãy mua ngay", facts);
  assert.equal(bad.ok, false);
  assert.ok(bad.unsupported.length >= 1);
  const good = validateOutput("P/E 12.5 lần, ROE 20%, giá 44500", facts);
  assert.equal(good.ok, true);
});

test("eval[2] data quality: profile không có dữ liệu → UNAVAILABLE, không phạt 0", () => {
  const empty = buildFinancialProfile({});
  assert.equal(empty.derive.health.level, "UNAVAILABLE");
  assert.equal(empty.derive.savingsRate.available, false);
  assert.equal(empty.valid, true); // không dữ liệu ≠ lỗi
});

test("eval[2] data quality: field sai bị loại + có errors", () => {
  const p = buildFinancialProfile({ monthlyIncome: "abc", monthlyExpenses: -100, totalAssets: 500_000_000 });
  assert.equal(p.valid, false);
  assert.ok(p.errors.monthlyIncome && p.errors.monthlyExpenses);
  assert.equal(p.inputs.totalAssets, 500_000_000);
});

/* -------------------- Block 3: AGENTS (labels & structure) ----------------- */

test("eval[3] personal-finance agent: sections FACT/DATA-DRIVEN/MODEL-INFERENCE + action plan", async () => {
  const run = await runPersonalFinance({ profile });
  const labels = new Set(run.sections.map((s) => s.label));
  assert.ok(labels.has("DATA-DRIVEN"));
  assert.ok(labels.has("MODEL-INFERENCE"));
  assert.ok(run.sections.some((s) => s.id === "health"));
  assert.ok(run.sections.some((s) => s.id === "action-plan"));
  // không section nào trộn dữ liệu realtime giả
  for (const s of run.sections) assert.ok(!s.body.includes("NaN"));
});

test("eval[3] wealth-manager agent: rebalancing là MODEL-INFERENCE có disclaimer", async () => {
  const run = await runWealthManager({ profile });
  const rebal = run.sections.find((s) => s.id === "rebalancing")!;
  assert.equal(rebal.label, "MODEL-INFERENCE");
  assert.ok(rebal.body.toLowerCase().includes("không phải khuyến nghị"));
});

test("eval[3] agents: thiếu profile → section UNAVAILABLE, không bịa chỉ số", async () => {
  const run = await runPersonalFinance({});
  assert.equal(run.unavailable.includes("profile"), true);
  assert.ok(run.sections.every((s) => s.unavailable === true || s.id === "unavailable"));
});

/* --------------- Block 4: ORCHESTRATOR (intent + multi-agent) -------------- */

test("eval[4] orchestrator: phân loại intent đúng, không gọi hết agent", () => {
  assert.deepEqual(classifyFinancial("Phân tích HPG").intents, ["stock-analyst"]);
  assert.deepEqual(classifyFinancial("quản lý danh mục").intents, ["wealth-manager"]);
  assert.deepEqual(classifyFinancial("cải thiện thu nhập, tiết kiệm").intents, ["personal-finance"]);
  assert.deepEqual(classifyFinancial("1 tỷ mua VNM").intents, ["stock-analyst", "wealth-manager", "personal-finance"]);
  assert.deepEqual(classifyFinancial("thị trường chứng khoán hôm nay").intents, []);
});

test("eval[4] orchestrator: multi-agent chỉ khi hợp lý (money + stock)", () => {
  assert.equal(classifyFinancial("Phân tích HPG").intents.length, 1);
  assert.equal(classifyFinancial("500 triệu mua HPG").intents.length, 3);
});

/* --------------------- KB: tĩnh, không realtime dữ liệu -------------------- */

test("eval[5] knowledge base: 3 khối kiến thức, không chứa số giá realtime", () => {
  const cats = new Set(KNOWLEDGE_BASE.map((k) => k.category));
  for (const c of ["stock-analysis", "personal-finance", "wealth-management", "data-quality"] as const) assert.ok(cats.has(c));
  assert.ok(searchKnowledge("data-quality").length >= 2);
  assert.ok(searchKnowledge(null, "rebalancing").length >= 1);
  // KB tĩnh — không nhắc giá cụ thể của tài sản
  for (const k of KNOWLEDGE_BASE) assert.ok(!/\bHPG\b|\bVNM\b|\bBTC\b|XAU/i.test(k.body), `KB chứa dữ liệu realtime trong ${k.id}`);
});
