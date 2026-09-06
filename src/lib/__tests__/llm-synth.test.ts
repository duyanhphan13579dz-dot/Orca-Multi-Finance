import test from "node:test";
import assert from "node:assert/strict";
import { synthesizeRun } from "../agents/llm-synth";
import { runBudgetPlanner } from "../agents/personal-finance";
import type { LlmResult } from "../ai/gateway";
import type { AgentRun } from "../agents/agent-types";

const fakeChat =
  (responses: (LlmResult | null)[]) =>
  async (): Promise<LlmResult | null> =>
    responses.shift() ?? null;

const mkResult = (text: string, model = "fake-model"): LlmResult => ({ text, model, role: "analysis", latencyMs: 1 });

const budgetRun = async (): Promise<AgentRun> => runBudgetPlanner("Tôi còn 500k tiêu trong 2 tuần, xăng 50k/tuần, ăn quán 50k/tuần");

test("llm-synth: chưa cấu hình → deterministic giữ nguyên (không gọi chat)", async () => {
  let called = false;
  const chat = async () => {
    called = true;
    return null;
  };
  const run = await budgetRun();
  const out = await synthesizeRun(run, { configured: false, chat });
  assert.equal(called, false);
  assert.equal(out.sections.some((s) => s.id === "llm-synthesis"), false);
  assert.ok(out.trace.includes("llm:not-configured"));
  assert.ok(out.narrative.includes("250.000")); // narrative deterministic còn nguyên
});

test("llm-synth: LLM trả đúng số trong contract → dùng narrative LLM + section tổng hợp", async () => {
  const run = await budgetRun();
  const out = await synthesizeRun(run, {
    configured: true,
    chat: fakeChat([mkResult("Ngân sách 500.000 chia 2 tuần, mỗi tuần 250.000. Xăng và ăn quán tổng 100.000/tuần, còn 150.000 cho linh hoạt.")]),
  });
  assert.equal(out.sections.some((s) => s.id === "llm-synthesis"), true);
  assert.ok(out.sections.some((s) => s.sources.some((x) => x.includes("fake-model"))));
  assert.ok(out.narrative.includes("250.000"));
  assert.ok(out.trace.some((t) => t.startsWith("llm:fake-model")));
});

test("llm-synth: LLM bịa số → regenerate 1 lần, đúng → dùng bản regenerate", async () => {
  const run = await budgetRun();
  const out = await synthesizeRun(run, {
    configured: true,
    chat: fakeChat([
      mkResult("Ngân sách 500.000, target giá 9999"), // số lạ 9999
      mkResult("Ngân sách 500.000 trong 2 tuần là 250.000/tuần, còn 150.000 linh hoạt."),
    ]),
  });
  assert.ok(out.narrative.includes("250.000"));
  assert.ok(!out.narrative.includes("9999"));
  assert.ok(out.trace.some((t) => t.includes("regenerated")));
});

test("llm-synth: LLM liên tục bịa số → fallback deterministic (không giữ text sai)", async () => {
  const run = await budgetRun();
  const original = run.narrative;
  const out = await synthesizeRun(run, {
    configured: true,
    chat: fakeChat([mkResult("Giá mục tiêu 1.000.000"), mkResult("Giá mục tiêu 2.000.000")]),
  });
  assert.equal(out.narrative, original); // deterministic là nguồn chính thức
  assert.ok(out.trace.includes("llm:fallback-deterministic"));
  assert.equal(out.sections.some((s) => s.id === "llm-synthesis"), false);
});

test("llm-synth: LLM trả null (timeout/lỗi) → fallback deterministic", async () => {
  const run = await budgetRun();
  const out = await synthesizeRun(run, { configured: true, chat: fakeChat([null]) });
  assert.ok(out.trace.includes("llm:no-response"));
  assert.ok(out.narrative.includes("250.000"));
});
