import "server-only";
import { env } from "../env";
import { httpJson } from "../http";

/**
 * LLM GATEWAY — 2-model kết hợp Groq + OpenRouter (full free, không thẻ)
 *  - Agent (reasoning/analysis/classification): Groq free — openai/gpt-oss-120b 131K, 500 tok/s, 30 req/min
 *    (thay qwen/qwen3-32b đã deprecated 07/2026 trên Groq → gpt-oss-120b là recommended replacement)
 *  - Reports (report): OpenRouter free — qwen/qwen3-235b-a22b:free 131K, 50 req/ngày/model, deep analytical
 * Nguồn cũ SiliconFlow đã bỏ theo yêu cầu user — quay về Groq + OpenRouter thuần free.
 */

export type LlmRole = "reasoning" | "analysis" | "classification" | "report";

export interface LlmResult {
  text: string;
  model: string;
  role: LlmRole;
  latencyMs: number;
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

/** Model mặc định tách biệt 2 nhiệm vụ: Groq (Agent) + OpenRouter (Reports) */
function normalizeModel(raw: string): string {
  const t = raw.trim();
  if (!t) return "openai/gpt-oss-120b"; // Groq default
  // alias cũ
  if (t.includes("qwen3.8-27b") || t === "qwen/qwen3.8-27b") return "openai/gpt-oss-120b"; // qwen3-32b deprecated trên Groq 07/2026
  const low = t.toLowerCase();
  // gpt-oss (Groq recommended replacement cho qwen3-32b deprecated)
  if (low.includes("gpt-oss-120b") || low.includes("gpt-oss-120")) return "openai/gpt-oss-120b";
  if (low.includes("gpt-oss-20b") || low.includes("gpt-oss-20")) return "openai/gpt-oss-20b";
  if (low.includes("qwen3.6-27b") || low.includes("qwen3-27b")) return "qwen/qwen3.6-27b";
  // Qwen3 cho Reports (OpenRouter :free)
  if (low.includes("235b")) {
    if (low.includes(":free")) return low.includes("qwen") ? t : "qwen/qwen3-235b-a22b:free";
    // nếu thiếu :free, thêm suffix cho OpenRouter free
    if (low.includes("qwen")) return t.includes(":") ? t : `${t}:free`;
    return "qwen/qwen3-235b-a22b:free";
  }
  if (low.includes("qwen3-32b") || low.includes("qwen3.2")) {
    // Groq đã deprecated qwen3-32b → trả về gpt-oss-120b nếu đang ở Groq
    return "openai/gpt-oss-120b";
  }
  if (low.includes("deepseek-v3") || low.includes("deepseek_v3")) return low.includes(":free") ? t : `${t.includes("/") ? t : `deepseek/${t}`}:free`;
  if (low.includes("deepseek-r1")) return low.includes(":free") ? t : "deepseek/deepseek-r1:free";
  if (low.includes(":free")) return t; // giữ nguyên model :free OpenRouter
  if (low.includes("qwen") || low.includes("openai") || low.includes("deepseek") || low.includes("meta-llama") || low.includes("llama") || low.includes("google") || low.includes("mistral")) {
    return t; // giữ nguyên nếu đã có provider prefix OpenRouter/Groq
  }
  return t;
}

export function modelFor(role: LlmRole): string {
  const envKey = `AI_MODEL_${role.toUpperCase()}`;
  const raw = process.env[envKey]?.trim();
  if (raw) return normalizeModel(raw);
  if (role === "report") {
    const reportRaw = process.env.OPENROUTER_MODEL?.trim() ?? process.env.AI_MODEL_REPORT?.trim();
    if (reportRaw) return normalizeModel(reportRaw);
    return normalizeModel(env.openRouterModel); // OpenRouter default: qwen3-235b:free
  }
  // reasoning / analysis / classification → Groq Agent
  const groqRaw = process.env.GROQ_MODEL?.trim() ?? process.env.AI_MODEL?.trim();
  if (groqRaw) return normalizeModel(groqRaw);
  return normalizeModel(env.groqModel);
}

function resolveBaseUrlFor(role: LlmRole, _model: string): string {
  if (role === "report") {
    // Reports → OpenRouter (free deep). Fallback về Groq nếu thiếu key OpenRouter nhưng có Groq
    if (env.openRouterApiKey) return env.openRouterBaseUrl.replace(/\/$/, "");
    // fallback Groq nếu chỉ có 1 key
    return env.groqBaseUrl.replace(/\/$/, "");
  }
  // Agent → Groq
  const explicit = process.env.GROQ_BASE_URL?.trim() ?? process.env.AI_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  return env.groqBaseUrl.replace(/\/$/, "");
}

function apiKeyFor(role: LlmRole): string | undefined {
  if (role === "report") return env.openRouterApiKey ?? env.groqApiKey ?? env.aiProviderKey;
  return env.groqApiKey ?? env.openRouterApiKey ?? env.aiProviderKey;
}

export function llmConfigured(): boolean {
  return Boolean(env.groqApiKey || env.openRouterApiKey || env.aiProviderKey);
}

export function llmRegistryInfo() {
  return {
    configured: llmConfigured(),
    providers: {
      groq: { baseUrl: env.groqBaseUrl, model: modelFor("reasoning"), hasKey: Boolean(env.groqApiKey) },
      openRouter: { baseUrl: env.openRouterBaseUrl, model: modelFor("report"), hasKey: Boolean(env.openRouterApiKey) },
    },
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
  const apiKey = apiKeyFor(role);
  if (!apiKey) return null;
  const model = modelFor(role);
  const baseUrl = resolveBaseUrlFor(role, model);
  const t0 = performance.now();
  const isReport = role === "report";
  const isOpenRouter = baseUrl.includes("openrouter");
  const defaultMax = isReport ? 3_072 : 2_048;
  const defaultTimeout = isReport ? 60_000 : 45_000;

  // Agent: 16 turns × 3.5k để tận dụng 128K ; Reports: không cần history
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

  const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
  // OpenRouter yêu cầu Referer/Title để xếp hạng và tránh bị chặn (không bắt buộc nhưng khuyến nghị)
  if (isOpenRouter) {
    headers["HTTP-Referer"] = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://orca-multi-finance.vercel.app";
    headers["X-Title"] = "Orca Multi Finance";
  }
  const res = await httpJson<ChatResponse>(`${baseUrl}/chat/completions`, {
    provider: `llm:${role}`,
    method: "POST",
    timeoutMs: opts.timeoutMs ?? defaultTimeout,
    retries: 0,
    headers,
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
