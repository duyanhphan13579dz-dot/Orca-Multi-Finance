import "server-only";
import { env } from "../env";
import { httpJson } from "../http";

/**
 * LLM GATEWAY — 2-model tách biệt, cùng nguồn SiliconFlow.
 *  - Agent (reasoning/analysis): Qwen3-32B 128K — long-context, linh hoạt, đọc đúng ngữ cảnh
 *  - Reports (report): Qwen3-235B-A22B 128K — deep analytical, tạo Morning Brief / Strategy / Company
 * Nguồn: SiliconFlow (https://api.siliconflow.cn/v1) — miễn phí công khai, ưu tiên Qwen.
 */

export type LlmRole = "reasoning" | "analysis" | "classification" | "report";

export interface LlmResult {
  text: string;
  model: string;
  role: LlmRole;
  latencyMs: number;
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

/** Model mặc định tách biệt 2 nhiệm vụ, cùng SiliconFlow */
function normalizeModel(raw: string): string {
  const t = raw.trim();
  if (!t) return "Qwen/Qwen3-32B";
  // alias cũ
  if (t.includes("qwen3.8-27b") || t === "qwen/qwen3.8-27b") return "Qwen/Qwen3-32B";
  const low = t.toLowerCase();
  // Qwen3-235B cho Reports
  if (low.includes("235b") || low.includes("qwen3-235") || low.includes("qwen3_235")) return "Qwen/Qwen3-235B-A22B";
  if (low.includes("qwen3-32b") || low.includes("qwen3.2")) return "Qwen/Qwen3-32B";
  if (low.includes("deepseek-v3") || low.includes("deepseek_v3")) return "deepseek-ai/DeepSeek-V3";
  if (low.includes("deepseek-r1")) return "deepseek-ai/DeepSeek-R1";
  if (low.includes("qwen")) {
    if (t.includes("/")) return t; // giữ nguyên nếu đã có provider prefix
    return `Qwen/${t}`;
  }
  return t;
}

export function modelFor(role: LlmRole): string {
  const envKey = `AI_MODEL_${role.toUpperCase()}`;
  const raw = process.env[envKey]?.trim();
  if (raw) return normalizeModel(raw);
  if (role === "report") {
    const reportRaw = process.env.AI_MODEL_REPORT?.trim() ?? process.env.AI_MODEL_ANALYSIS?.trim();
    if (reportRaw) return normalizeModel(reportRaw);
    return "Qwen/Qwen3-235B-A22B"; // mặc định Reports là 235B để tách biệt Agent 32B
  }
  // reasoning / analysis / classification → Agent 32B
  return normalizeModel(env.aiModel);
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
      report: modelFor("report"),
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
  const isReport = role === "report";
  const defaultMax = isReport ? 3_072 : 2_048;
  const defaultTimeout = isReport ? 60_000 : 45_000;

  // Agent: 16 turns × 3.5k để tận dụng 128K ; Reports: không cần history, nhưng vẫn xử lý nếu có
  const history = isReport
    ? []
    : (opts.history ?? [])
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
    timeoutMs: opts.timeoutMs ?? defaultTimeout,
    retries: 0,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.aiProviderKey}` },
    body: JSON.stringify({
      model,
      temperature: opts.temperature ?? (isReport ? 0.25 : 0.3),
      max_tokens: opts.maxTokens ?? defaultMax,
      messages,
    }),
  });
  const text = res.data?.choices?.[0]?.message?.content;
  if (!res.ok || !text || !text.trim()) return null;
  return { text: text.trim(), model, role, latencyMs: Math.round(performance.now() - t0) };
}
