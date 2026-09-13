import "server-only";
import { DEFAULT_LLM_MODEL, env } from "../env";
import { httpJson } from "../http";

/**
 * LLM GATEWAY — OpenRouter-first, role-based model selection.
 *
 * Env (Vercel):
 *   OPENROUTER_API_KEY   — primary key
 *   OPENROUTER_MODEL     — default model id (provider/model)
 *   AI_MODEL_REASONING   — deep reasoning / compare
 *   AI_MODEL_REPORT      — financial report / analysis / forecast
 *   AI_MODEL_ANALYSIS    — optional alias for report
 *   GROQ_*               — optional fast path (not default for BCTC analysis)
 */

export type LlmRole = "reasoning" | "analysis" | "classification" | "report";
export type LlmBackend = "openrouter" | "groq";

export interface LlmResult {
  text: string;
  model: string;
  role: LlmRole;
  latencyMs: number;
  provider: "openrouter" | "groq" | "openai-compatible";
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

function firstDefined(...vals: (string | undefined)[]): string | undefined {
  for (const v of vals) {
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

/** Chọn model theo role — bám biến Vercel của user (mọi biến đọc qua src/lib/env.ts). */
export function modelFor(role: LlmRole): string {
  if (role === "reasoning") {
    return (
      firstDefined(env.aiModelReasoning, env.openrouterModel, env.aiModel) ?? DEFAULT_LLM_MODEL
    );
  }
  if (role === "report" || role === "analysis") {
    return (
      firstDefined(
        env.aiModelReport,
        env.aiModelAnalysis,
        env.openrouterModel,
        env.aiModel,
      ) ?? DEFAULT_LLM_MODEL
    );
  }
  // classification → model nhẹ / default OpenRouter
  return firstDefined(env.openrouterModel, env.aiModel, env.groqModel) ?? DEFAULT_LLM_MODEL;
}

function resolveProvider(model: string, backend?: LlmBackend): {
  baseUrl: string;
  apiKey: string | undefined;
  provider: LlmResult["provider"];
} {
  if (backend === "groq") {
    return {
      baseUrl: (env.groqBaseUrl ?? "https://api.groq.com/openai/v1").replace(/\/$/, ""),
      apiKey: env.groqApiKey,
      provider: "groq",
    };
  }
  if (backend === "openrouter") {
    return {
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: env.openrouterApiKey,
      provider: "openrouter",
    };
  }

  // Explicit AI_BASE_URL wins
  if (env.aiBaseUrl?.trim()) {
    const base = env.aiBaseUrl.replace(/\/$/, "");
    const isOr = base.includes("openrouter");
    const isGroq = base.includes("groq");
    return {
      baseUrl: base,
      apiKey: isOr
        ? env.openrouterApiKey ?? env.aiProviderKey
        : isGroq
          ? env.groqApiKey ?? env.aiProviderKey
          : env.aiProviderKey,
      provider: isOr ? "openrouter" : isGroq ? "groq" : "openai-compatible",
    };
  }

  // OpenRouter when key present OR model looks like provider/model
  if (env.openrouterApiKey || model.includes("/")) {
    return {
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: env.openrouterApiKey ?? env.aiProviderKey,
      provider: "openrouter",
    };
  }

  if (env.groqApiKey) {
    return {
      baseUrl: (env.groqBaseUrl ?? "https://api.groq.com/openai/v1").replace(/\/$/, ""),
      apiKey: env.groqApiKey,
      provider: "groq",
    };
  }

  return {
    baseUrl: "https://api.openai.com/v1",
    apiKey: env.aiProviderKey,
    provider: "openai-compatible",
  };
}

export function llmConfigured(): boolean {
  return Boolean(env.openrouterApiKey || env.aiProviderKey || env.groqApiKey);
}

/** Thông tin registry (không lộ secret) — dùng /system hoặc debug */
export function llmRegistryInfo() {
  const roles: LlmRole[] = ["reasoning", "analysis", "report", "classification"];
  const models: Record<string, string> = {};
  for (const r of roles) models[r] = modelFor(r);
  const sample = modelFor("analysis");
  const { baseUrl, provider } = resolveProvider(sample);
  return {
    configured: llmConfigured(),
    provider,
    baseUrl,
    models,
    envPresent: {
      OPENROUTER_API_KEY: Boolean(env.openrouterApiKey),
      OPENROUTER_MODEL: Boolean(env.openrouterModel),
      AI_MODEL_REASONING: Boolean(env.aiModelReasoning),
      AI_MODEL_REPORT: Boolean(env.aiModelReport),
      AI_MODEL_ANALYSIS: Boolean(env.aiModelAnalysis),
      GROQ_API_KEY: Boolean(env.groqApiKey),
      AI_PROVIDER_KEY: Boolean(env.aiProviderKeyRaw),
    },
    /** Model OpenRouter mặc định đang resolve (không phải secret) */
    openrouterModelResolved: env.openrouterModel ?? env.aiModel ?? null,
  };
}

interface ChatOptions {
  system: string;
  user: string;
  history?: ChatTurn[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  modelOverride?: string;
  backend?: LlmBackend;
}

type ChatResponse = { choices?: { message?: { content?: string } }[] };

export async function llmChat(role: LlmRole, opts: ChatOptions): Promise<LlmResult | null> {
  const model = opts.modelOverride?.trim() || modelFor(role);
  const { baseUrl, apiKey, provider } = resolveProvider(model, opts.backend);
  if (!apiKey) return null;

  const t0 = performance.now();

  const history = (opts.history ?? [])
    .filter((t) => t.content?.trim())
    .slice(-16)
    .map((t) => ({
      role: t.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: t.content.trim().slice(0, 2_500),
    }));

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: opts.system },
    ...history,
    { role: "user", content: opts.user },
  ];

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  // OpenRouter khuyến nghị HTTP-Referer + X-Title
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = env.vercelUrl
      ? `https://${env.vercelUrl}`
      : "https://orca-multi-finance.vercel.app";
    headers["X-Title"] = "Orca Multi Finance";
  }

  const res = await httpJson<ChatResponse>(`${baseUrl}/chat/completions`, {
    provider: `llm:${provider}:${role}`,
    method: "POST",
    timeoutMs: opts.timeoutMs ?? 45_000,
    retries: 0,
    headers,
    body: JSON.stringify({
      model,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 1200,
      messages,
    }),
  });

  const text = res.data?.choices?.[0]?.message?.content;
  if (!res.ok || !text || !text.trim()) return null;
  return {
    text: text.trim(),
    model,
    role,
    latencyMs: Math.round(performance.now() - t0),
    provider,
  };
}
