import test from "node:test";
import assert from "node:assert/strict";
import { buildChatRequest, modelFor, llmRegistryInfo } from "../ai/gateway";

test("gateway: modelFor trả AI_MODEL (role-specific override nếu có)", () => {
  // node:test chạy trong process có env của repo — chỉ kiểm tra không crash + trả string
  assert.equal(typeof modelFor("analysis"), "string");
  const info = llmRegistryInfo();
  assert.equal(typeof info.models.analysis, "string");
  assert.ok(info.models.analysis.length > 0);
});

test("gateway: buildChatRequest dùng đúng model user set + payload chuẩn", () => {
  const prev = process.env.AI_MODEL;
  process.env.AI_MODEL = "qwen3.8-27b";
  try {
    const r = buildChatRequest("analysis", {
      system: "sys",
      user: "user",
      temperature: 0.4,
      maxTokens: 800,
    });
    assert.equal(r.body.model, "qwen3.8-27b");
    assert.equal((r.body.messages as { role: string; content: string }[])[1].content, "user");
    assert.equal(r.body.temperature, 0.4);
    assert.equal(r.body.max_tokens, 800);
    assert.ok(r.url.endsWith("/chat/completions"));
  } finally {
    process.env.AI_MODEL = prev ?? "";
  }
});

test("gateway: Qwen3 → chat_template_kwargs enable_thinking=false (vLLM)", () => {
  const prev = process.env.AI_MODEL;
  process.env.AI_MODEL = "qwen3.8-27b";
  try {
    const r = buildChatRequest("analysis", { system: "s", user: "u" });
    assert.deepEqual(r.body.chat_template_kwargs, { enable_thinking: false });
  } finally {
    process.env.AI_MODEL = prev ?? "";
  }
});

test("gateway: keyless local → KHÔNG gửi Authorization (endpoint local không cần key)", () => {
  const prevKey = process.env.AI_PROVIDER_KEY;
  const prevBase = process.env.AI_BASE_URL;
  delete process.env.AI_PROVIDER_KEY;
  process.env.AI_BASE_URL = "http://localhost:11434/v1";
  try {
    const r = buildChatRequest("analysis", { system: "s", user: "u" });
    assert.equal("Authorization" in r.headers, false);
    assert.ok(r.url.startsWith("http://localhost:11434/v1/chat/completions"));
  } finally {
    if (prevKey != null) process.env.AI_PROVIDER_KEY = prevKey;
    if (prevBase != null) process.env.AI_BASE_URL = prevBase;
  }
});

test("gateway: có key → gửi Bearer token", () => {
  const prevKey = process.env.AI_PROVIDER_KEY;
  process.env.AI_PROVIDER_KEY = "test-key-123";
  try {
    const r = buildChatRequest("analysis", { system: "s", user: "u" });
    assert.equal(r.headers.Authorization, "Bearer test-key-123");
  } finally {
    if (prevKey != null) process.env.AI_PROVIDER_KEY = prevKey;
    else delete process.env.AI_PROVIDER_KEY;
  }
});
