import "server-only";
import { env } from "../env";
import { httpJson } from "../http";

/**
 * LLM GATEWAY — provider-agnostic, ưu tiên SiliconFlow cho Qwen3.
 * Nguồn mới: SiliconFlow (https://api.siliconflow.cn/v1) — miễn phí công khai,
 *            ưu tiên Qwen3-32B 128K, không như Groq.
 * Hỗ trợ history 16 turns để tận dụng long-context.
 */

export type LlmRole = "reasoning" | "analysis" | "classification";

export interface LlmResult {
  text: string;
  model: string;
  role: LlmRole;
  latencyMs: number;
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

/** Model mặc định: Qwen3-32B 128K long-context — SiliconFlow Qwen/Qwen3-32B (Apache 2.0, miễn phí, ưu tiên Qwen) */
function normalizeModel(raw: string): string {
  const t = raw.trim();
  if (!t) return "Qwen/Qwen3-32B";
  // alias cũ qwen3.8-27b / qwen/qwen3-32b → chuẩn SiliconFlow
  if (t.includes("qwen3.8-27b") || t === "qwen/qwen3.8-27b") return "Qwen/Qwen3-32B";
  if (t.toLowerCase().includes("qwen3-32b") || t.toLowerCase().includes("qwen3.2")) return "Qwen/Qwen3-32B";
  if (t.toLowerCase().includes("qwen")) {
    // Giữ provider prefix nếu có, chuẩn hoá về Qwen/Qwen3-32B cho SiliconFlow
    if (t.includes("/")) {
      const lower = t.toLowerCase();
      if (lower.includes("qwen3-32b")) return "Qwen/Qwen3-32B";
      return t;
    }
    return `Qwen/${t}`;
  }
  return t;
}

export function modelFor(role: LlmRole): string {
  const raw = process.env[`AI_MODEL_${role.toUpperCase()}`]?.trim() ?? env.aiModel;
  const m = normalizeModel(raw);
  return m;
}

function resolveBaseUrl(_model: string): string {
  const explicit = env.aiBaseUrl?.replace(/\/$/, "");
  if (explicit) return explicit;
  // Mặc định mới: SiliconFlow — miễn phí, ưu tiên Qwen3-32B (thay Groq)
  return "https://api.siliconflow.cn/v1";
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
