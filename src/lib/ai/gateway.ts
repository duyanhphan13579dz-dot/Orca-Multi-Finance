import "server-only";
import { env } from "../env";
import { httpJson } from "../http";

/**
 * LLM GATEWAY — model selection by task role, provider-agnostic.
 * Swap models via env without touching business logic:
 *   AI_MODEL / AI_MODEL_REASONING / AI_MODEL_ANALYSIS / AI_MODEL_CLASSIFICATION
 *   AI_BASE_URL (OpenAI-compatible), AI_PROVIDER_KEY
 * Bật LLM: AI_PROVIDER_KEY (cloud) HOẶC AI_LLM_ENABLED=true (local không cần key,
 * VD Ollama/vLLM/LM Studio với AI_BASE_URL=http://localhost:11434/v1).
 */

export type LlmRole = "reasoning" | "analysis" | "classification";

export interface LlmResult {
  text: string;
  model: string;
  role: LlmRole;
  latencyMs: number;
}

export function modelFor(role: LlmRole): string {
  return process.env[`AI_MODEL_${role.toUpperCase()}`]?.trim() ?? process.env.AI_MODEL?.trim() ?? env.aiModel;
}

export function llmConfigured(): boolean {
  return Boolean(env.aiProviderKey) || env.aiLlmEnabled;
}

export function llmRegistryInfo() {
  return {
    configured: llmConfigured(),
    baseUrl: env.aiBaseUrl,
    hasKey: Boolean(env.aiProviderKey),
    localMode: env.aiLlmEnabled,
    models: {
      reasoning: modelFor("reasoning"),
      analysis: modelFor("analysis"),
      classification: modelFor("classification"),
    },
  };
}

interface ChatOptions {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

type ChatResponse = { choices?: { message?: { content?: string; reasoning_content?: string } }[] };

/** body request + headers — tách riêng để test (không cần mạng). */
export function buildChatRequest(role: LlmRole, opts: ChatOptions): {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
} {
  const model = modelFor(role);
  const base = (process.env.AI_BASE_URL?.trim() || env.aiBaseUrl).replace(/\/$/, "");
  const key = process.env.AI_PROVIDER_KEY?.trim() || env.aiProviderKey;
  const idempotent: Record<string, string> = { "Content-Type": "application/json" };
  if (key) idempotent.Authorization = `Bearer ${key}`;
  const body: Record<string, unknown> = {
    model,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 900,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  };
  // Qwen3 (vLLM) hỗ trợ tắt chế độ thinking để trả câu trả lời sạch
  if (/qwen3/i.test(model) || /vllm/i.test(base)) {
    body.chat_template_kwargs = { enable_thinking: false };
  }
  return { url: `${base}/chat/completions`, headers: idempotent, body };
}

export async function llmChat(role: LlmRole, opts: ChatOptions): Promise<LlmResult | null> {
  if (!llmConfigured()) return null;
  const { url, headers, body } = buildChatRequest(role, opts);
  const t0 = performance.now();
  const res = await httpJson<ChatResponse>(url, {
    provider: `llm:${role}`,
    method: "POST",
    timeoutMs: opts.timeoutMs ?? 28_000,
    retries: 0,
    headers,
    body: JSON.stringify(body),
  });
  const msg = res.data?.choices?.[0]?.message;
  // Qwen3: content (câu trả lời) ưu tiên; nếu rỗng (một số deployment) lấy reasoning_content
  const text = msg?.content?.trim() || msg?.reasoning_content?.trim();
  if (!res.ok || !text) return null;
  return { text, model: String(body.model), role, latencyMs: Math.round(performance.now() - t0) };
}
