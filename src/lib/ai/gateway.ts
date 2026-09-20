import "server-only";
import { env } from "../env";
import { httpJson } from "../http";

/**
 * LLM GATEWAY — OpenRouter-first, role-based model selection + sequential cascade.
 *
 * Env (Vercel / .env):
 *   OPENROUTER_API_KEY              — primary key
 *   OPENROUTER_MODEL                — default model id (provider/model[:free])
 *   AI_MODEL_REASONING              — deep reasoning
 *   AI_MODEL_REASONING_FALLBACKS    — comma list after primary
 *   AI_MODEL_REPORT / AI_MODEL_ANALYSIS
 *   AI_MODEL_REPORT_FALLBACKS / AI_MODEL_ANALYSIS_FALLBACKS
 *   GROQ_* + AI_LLM_FALLBACK_BACKEND=groq — last-resort when OpenRouter 429/5xx
 */

export type LlmRole = "reasoning" | "analysis" | "classification" | "report";
export type LlmBackend = "openrouter" | "groq";

export interface LlmResult {
  text: string;
  model: string;
  role: LlmRole;
  latencyMs: number;
  provider: "openrouter" | "groq" | "openai-compatible";
  /** Models tried before success (empty if first candidate worked) */
  attemptedModels?: string[];
  /** true if response came from AI_LLM_FALLBACK_BACKEND (e.g. Groq) */
  usedBackendFallback?: boolean;
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

function firstDefined(...vals: (string | undefined)[]): string | undefined {
  for (const v of vals) {
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

function dedupeModels(ids: (string | undefined | null)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = raw?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Primary model for role (first in cascade). */
export function modelFor(role: LlmRole): string {
  return modelsFor(role)[0] ?? "qwen/qwen3.8-27b:free";
}

/**
 * Ordered candidate list: primary → role fallbacks → OPENROUTER_MODEL → safe free default.
 * Services keep calling modelFor(); llmChat walks the full cascade.
 */
export function modelsFor(role: LlmRole): string[] {
  if (role === "reasoning") {
    return dedupeModels([
      firstDefined(env.aiModelReasoning, process.env.AI_MODEL_REASONING),
      ...env.aiModelReasoningFallbacks,
      env.openrouterModel,
      env.aiModel,
      "nvidia/nemotron-3-super-120b-a12b:free",
      "openrouter/free",
    ]);
  }
  if (role === "report") {
    return dedupeModels([
      firstDefined(
        env.aiModelReport,
        env.aiModelAnalysis,
        process.env.AI_MODEL_REPORT,
        process.env.AI_MODEL_ANALYSIS,
      ),
      ...env.aiModelReportFallbacks,
      ...env.aiModelAnalysisFallbacks,
      env.openrouterModel,
      env.aiModel,
      "inclusionai/ling-3.0-flash-fin:free",
      "qwen/qwen3.8-27b:free",
      "openrouter/free",
    ]);
  }
  if (role === "analysis") {
    return dedupeModels([
      firstDefined(
        env.aiModelAnalysis,
        env.aiModelReport,
        process.env.AI_MODEL_ANALYSIS,
        process.env.AI_MODEL_REPORT,
      ),
      ...env.aiModelAnalysisFallbacks,
      ...env.aiModelReportFallbacks,
      env.openrouterModel,
      env.aiModel,
      "inclusionai/ling-3.0-flash-fin:free",
      "qwen/qwen3.8-27b:free",
      "openrouter/free",
    ]);
  }
  // classification — light / default
  return dedupeModels([
    env.openrouterModel,
    env.aiModel,
    env.groqModel,
    ...env.aiModelClassificationFallbacks,
    "qwen/qwen3.8-27b:free",
    "openrouter/free",
  ]);
}

function resolveProvider(
  model: string,
  backend?: LlmBackend,
): {
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

/** Registry (no secrets) — GET /api/v1/system/llm */
export function llmRegistryInfo() {
  const roles: LlmRole[] = ["reasoning", "analysis", "report", "classification"];
  const models: Record<string, string> = {};
  const cascades: Record<string, string[]> = {};
  for (const r of roles) {
    models[r] = modelFor(r);
    cascades[r] = modelsFor(r);
  }
  const sample = modelFor("analysis");
  const { baseUrl, provider } = resolveProvider(sample);
  return {
    configured: llmConfigured(),
    provider,
    baseUrl,
    models,
    cascades,
    cascadeEnabled: true,
    fallbackBackend:
      env.aiLlmFallbackBackend === "groq" && env.groqApiKey
        ? { backend: "groq", model: env.groqModel ?? null }
        : null,
    envPresent: {
      OPENROUTER_API_KEY: Boolean(env.openrouterApiKey),
      OPENROUTER_MODEL: Boolean(env.openrouterModel),
      AI_MODEL_REASONING: Boolean(env.aiModelReasoning),
      AI_MODEL_REPORT: Boolean(env.aiModelReport),
      AI_MODEL_ANALYSIS: Boolean(env.aiModelAnalysis),
      AI_MODEL_ANALYSIS_FALLBACKS: env.aiModelAnalysisFallbacks.length > 0,
      AI_MODEL_REASONING_FALLBACKS: env.aiModelReasoningFallbacks.length > 0,
      AI_MODEL_REPORT_FALLBACKS: env.aiModelReportFallbacks.length > 0,
      GROQ_API_KEY: Boolean(env.groqApiKey),
      AI_LLM_FALLBACK_BACKEND: env.aiLlmFallbackBackend || null,
      AI_PROVIDER_KEY: Boolean(process.env.AI_PROVIDER_KEY?.trim()),
    },
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
  /** Skip cascade — only try modelOverride / modelFor once (default false) */
  disableCascade?: boolean;
}

type ChatResponse = { choices?: { message?: { content?: string } }[] };

async function callOnce(
  model: string,
  role: LlmRole,
  opts: ChatOptions,
  backend?: LlmBackend,
): Promise<{
  result: LlmResult | null;
  rateLimited: boolean;
  providerError: boolean;
}> {
  const { baseUrl, apiKey, provider } = resolveProvider(model, backend);
  if (!apiKey) {
    return { result: null, rateLimited: false, providerError: true };
  }

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
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "https://orca-multi-finance.vercel.app";
    headers["X-Title"] = "Orca Multi Finance";
  }

  try {
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

    const status = res.status ?? (res.ok ? 200 : 500);
    const rateLimited = status === 429;
    const providerError = !res.ok || status >= 500;
    const text = res.data?.choices?.[0]?.message?.content;
    if (!res.ok || !text || !text.trim()) {
      return { result: null, rateLimited, providerError };
    }
    return {
      result: {
        text: text.trim(),
        model,
        role,
        latencyMs: Math.round(performance.now() - t0),
        provider,
      },
      rateLimited: false,
      providerError: false,
    };
  } catch {
    return { result: null, rateLimited: false, providerError: true };
  }
}

/**
 * Sequential cascade: try each model in modelsFor(role) until one returns text.
 * If OpenRouter cascade exhausts with rate-limit/errors and AI_LLM_FALLBACK_BACKEND=groq,
 * one final attempt uses GROQ_MODEL on Groq.
 */
export async function llmChat(role: LlmRole, opts: ChatOptions): Promise<LlmResult | null> {
  if (!llmConfigured()) return null;

  const candidates = opts.disableCascade
    ? dedupeModels([opts.modelOverride?.trim() || modelFor(role)])
    : opts.modelOverride?.trim()
      ? dedupeModels([opts.modelOverride.trim(), ...modelsFor(role)])
      : modelsFor(role);

  if (!candidates.length) return null;

  const attempted: string[] = [];
  let sawRateLimit = false;
  let sawProviderError = false;

  for (const model of candidates) {
    attempted.push(model);
    const { result, rateLimited, providerError } = await callOnce(model, role, opts, opts.backend);
    if (rateLimited) sawRateLimit = true;
    if (providerError) sawProviderError = true;
    if (result) {
      return {
        ...result,
        attemptedModels: attempted.length > 1 ? attempted.slice(0, -1) : [],
      };
    }
  }

  // Optional backend fallback (e.g. Groq) after OpenRouter cascade fails hard
  const wantGroqFallback =
    !opts.backend &&
    env.aiLlmFallbackBackend === "groq" &&
    Boolean(env.groqApiKey) &&
    (sawRateLimit || sawProviderError);

  if (wantGroqFallback) {
    const groqModel =
      firstDefined(env.groqModel, process.env.GROQ_MODEL) ?? "llama-3.3-70b-versatile";
    attempted.push(`groq:${groqModel}`);
    const { result } = await callOnce(groqModel, role, opts, "groq");
    if (result) {
      return {
        ...result,
        attemptedModels: attempted.slice(0, -1),
        usedBackendFallback: true,
      };
    }
  }

  return null;
}
