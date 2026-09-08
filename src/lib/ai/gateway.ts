import "server-only";
import { env } from "../env";
import { httpJson } from "../http";

/**
 * LLM GATEWAY — model selection by task role, provider-agnostic.
 * Supports optional multi-turn history for conversation continuity.
 *
 * AI_BASE_URL is optional: if omitted, namespace models (e.g. qwen/…)
 * route to OpenRouter; otherwise OpenAI-compatible default.
 */

export type LlmRole = "reasoning" | "analysis" | "classification";

export interface LlmResult {
  text: string;
  model: string;
  role: LlmRole;
  latencyMs: number;
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

/** Model mặc định: Qwen3-32B 128K long-context — miễn phí công khai (Apache 2.0) qua Hugging Face / Groq / OpenRouter */
function normalizeModel(raw: string): string {
  const t = raw.trim();
  if (!t) return "qwen/qwen3-32b";
  // alias cũ qwen3.8-27b → chuyển sang qwen3-32b 128K
  if (t.includes("qwen3.8-27b") || t === "qwen/qwen3.8-27b") return "qwen/qwen3-32b";
  if (t.includes("qwen")) return t.includes("/") ? t : `qwen/${t}`;
  return t;
}

export function modelFor(role: LlmRole): string {
  const raw = process.env[`AI_MODEL_${role.toUpperCase()}`]?.trim() ?? env.aiModel;
  const m = normalizeModel(raw);
  return m;
}

function resolveBaseUrl(model: string): string {
  const explicit = env.aiBaseUrl?.replace(/\/$/, "");
  if (explicit) return explicit;
  // provider/model ids (OpenRouter-style) — no AI_BASE_URL required
  if (model.includes("/")) return "https://openrouter.ai/api/v1";
  return "https://api.openai.com/v1";
}

export function llmConfigured(): boolean {
  return Boolean(env.aiProviderKey);
}

export function llmRegistryInfo() {
  const model = env.aiModel;
  return {
    configured: llmConfigured(),
    baseUrl: resolveBaseUrl(model),
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
  /** Prior turns (oldest → newest). Current user message is `user`, not duplicated here. */
  history?: ChatTurn[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

type ChatResponse = { choices?: { message?: { content?: string } }[] };

export async function llmChat(role: LlmRole, opts: ChatOptions): Promise<LlmResult | null> {
  if (!env.aiProviderKey) return null;
  const model = modelFor(role);
  const baseUrl = resolveBaseUrl(model);
  const t0 = performance.now();

  // Long-context: giữ tới 16 turns, mỗi turn 3.5k ký tự (~1k tokens) để tận dụng 128K
  const history = (opts.history ?? [])
    .filter((t) => t.content?.trim())
    .slice(-16)
    .map((t) => ({
      role: t.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: t.content.trim().slice(0, 3_500),
    }));

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: opts.system },
    ...history,
    { role: "user", content: opts.user },
  ];

  const res = await httpJson<ChatResponse>(`${baseUrl}/chat/completions`, {
    provider: `llm:${role}`,
    method: "POST",
    timeoutMs: opts.timeoutMs ?? 45_000,
    retries: 0,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.aiProviderKey}` },
    body: JSON.stringify({
      model,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 2_048,
      messages,
    }),
  });
  const text = res.data?.choices?.[0]?.message?.content;
  if (!res.ok || !text || !text.trim()) return null;
  return { text: text.trim(), model, role, latencyMs: Math.round(performance.now() - t0) };
}
