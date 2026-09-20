import "server-only";
import { env } from "../env";
import { httpJson } from "../http";

/**
 * LLM GATEWAY — OpenRouter-first + fast cascade (production).
 * Race first 2 models, cap attempts, short fallback timeout, soft cooldown.
 */

export type LlmRole = "reasoning" | "analysis" | "classification" | "report";
export type LlmBackend = "openrouter" | "groq";

export interface LlmResult {
  text: string;
  model: string;
  role: LlmRole;
  latencyMs: number;
  provider: "openrouter" | "groq" | "openai-compatible";
  attemptedModels?: string[];
  usedBackendFallback?: boolean;
  raced?: boolean;
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

const modelCooldownUntil = new Map<string, number>();
const COOLDOWN_MS = 45_000;

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

function markCooldown(model: string) {
  modelCooldownUntil.set(model, Date.now() + COOLDOWN_MS);
}

function isCooling(model: string): boolean {
  const until = modelCooldownUntil.get(model);
  if (!until) return false;
  if (Date.now() >= until) {
    modelCooldownUntil.delete(model);
    return false;
  }
  return true;
}

function maxCascade(): number {
  const n = Number(process.env.AI_LLM_MAX_CASCADE ?? env.aiLlmMaxCascade ?? 3);
  if (!Number.isFinite(n) || n < 1) return 3;
  return Math.min(6, Math.floor(n));
}

function cascadeMode(): "race" | "sequential" {
  const m = (process.env.AI_LLM_CASCADE_MODE ?? env.aiLlmCascadeMode ?? "race").toLowerCase();
  return m === "sequential" ? "sequential" : "race";
}

export function modelFor(role: LlmRole): string {
  return modelsFor(role)[0] ?? "qwen/qwen3.8-27b:free";
}

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
      firstDefined(env.aiModelReport, env.aiModelAnalysis, process.env.AI_MODEL_REPORT, process.env.AI_MODEL_ANALYSIS),
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
      firstDefined(env.aiModelAnalysis, env.aiModelReport, process.env.AI_MODEL_ANALYSIS, process.env.AI_MODEL_REPORT),
      ...env.aiModelAnalysisFallbacks,
      ...env.aiModelReportFallbacks,
      env.openrouterModel,
      env.aiModel,
      "inclusionai/ling-3.0-flash-fin:free",
      "qwen/qwen3.8-27b:free",
      "openrouter/free",
    ]);
  }
  return dedupeModels([
    env.openrouterModel,
    env.aiModel,
    env.groqModel,
    ...env.aiModelClassificationFallbacks,
    "qwen/qwen3.8-27b:free",
    "openrouter/free",
  ]);
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
  if (env.aiBaseUrl?.trim()) {
    const base = env.aiBaseUrl.replace(/\/$/, "");
    const isOr = base.includes("openrouter");
    const isGroq = base.includes("groq");
    return {
      baseUrl: base,
      apiKey: isOr ? env.openrouterApiKey ?? env.aiApiKey : isGroq ? env.groqApiKey ?? env.aiApiKey : env.aiApiKey,
      provider: isOr ? "openrouter" : isGroq ? "groq" : "openai-compatible",
    };
  }
  if (env.openrouterApiKey || model.includes("/")) {
    return {
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: env.openrouterApiKey ?? env.aiApiKey,
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
  return { baseUrl: "https://api.openai.com/v1", apiKey: env.aiApiKey, provider: "openai-compatible" };
}

export function llmConfigured(): boolean {
  return Boolean(env.openrouterApiKey || env.aiApiKey || env.groqApiKey);
}

export function llmRegistryInfo() {
  const roles: LlmRole[] = ["reasoning", "analysis", "report", "classification"];
  const models: Record<string, string> = {};
  const cascades: Record<string, string[]> = {};
  for (const r of roles) {
    models[r] = modelFor(r);
    cascades[r] = modelsFor(r).slice(0, maxCascade());
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
    cascadeMode: cascadeMode(),
    maxCascade: maxCascade(),
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
      AI_LLM_CASCADE_MODE: cascadeMode(),
      AI_LLM_MAX_CASCADE: maxCascade(),
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
  disableCascade?: boolean;
}

type ChatResponse = { choices?: { message?: { content?: string } }[] };

type CallOutcome = {
  result: LlmResult | null;
  rateLimited: boolean;
  providerError: boolean;
  invalidModel: boolean;
};

async function callOnce(
  model: string,
  role: LlmRole,
  opts: ChatOptions,
  backend: LlmBackend | undefined,
  timeoutMs: number,
): Promise<CallOutcome> {
  const { baseUrl, apiKey, provider } = resolveProvider(model, backend);
  if (!apiKey) return { result: null, rateLimited: false, providerError: true, invalidModel: false };

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
      timeoutMs,
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
    const invalidModel = status === 400 || status === 404;
    const providerError = !res.ok || status >= 500;
    const text = res.data?.choices?.[0]?.message?.content;

    if (!res.ok || !text || !text.trim()) {
      if (rateLimited || providerError || invalidModel) markCooldown(model);
      return { result: null, rateLimited, providerError, invalidModel };
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
      invalidModel: false,
    };
  } catch {
    markCooldown(model);
    return { result: null, rateLimited: false, providerError: true, invalidModel: false };
  }
}

function primaryTimeout(opts: ChatOptions): number {
  return opts.timeoutMs ?? 28_000;
}

function fallbackTimeout(opts: ChatOptions): number {
  const base = opts.timeoutMs ?? 28_000;
  return Math.min(12_000, Math.max(8_000, Math.floor(base * 0.45)));
}

export async function llmChat(role: LlmRole, opts: ChatOptions): Promise<LlmResult | null> {
  if (!llmConfigured()) return null;

  const full = opts.disableCascade
    ? dedupeModels([opts.modelOverride?.trim() || modelFor(role)])
    : opts.modelOverride?.trim()
      ? dedupeModels([opts.modelOverride.trim(), ...modelsFor(role)])
      : modelsFor(role);

  const candidates = full.filter((m) => !isCooling(m)).slice(0, opts.disableCascade ? 1 : maxCascade());
  const list = candidates.length ? candidates : full.slice(0, 1);
  if (!list.length) return null;

  const attempted: string[] = [];
  let sawRateLimit = false;
  let sawProviderError = false;
  const tPrimary = primaryTimeout(opts);
  const tFallback = fallbackTimeout(opts);
  const mode = cascadeMode();

  if (mode === "race" && list.length >= 2 && !opts.backend) {
    const pair = list.slice(0, 2);
    attempted.push(...pair);
    const settled = await Promise.all(
      pair.map((model, i) => callOnce(model, role, opts, opts.backend, i === 0 ? tPrimary : tFallback)),
    );
    for (const o of settled) {
      if (o.rateLimited) sawRateLimit = true;
      if (o.providerError) sawProviderError = true;
    }
    const wins = settled
      .map((o, i) => ({ o, i, model: pair[i]! }))
      .filter((x) => x.o.result);
    if (wins.length) {
      wins.sort((a, b) => {
        if (a.i === 0 && b.i !== 0) return -1;
        if (b.i === 0 && a.i !== 0) return 1;
        return (a.o.result!.latencyMs ?? 0) - (b.o.result!.latencyMs ?? 0);
      });
      const best = wins[0]!;
      return {
        ...best.o.result!,
        attemptedModels: attempted.filter((m) => m !== best.model),
        raced: true,
      };
    }
    for (let i = 2; i < list.length; i++) {
      const model = list[i]!;
      attempted.push(model);
      const o = await callOnce(model, role, opts, opts.backend, tFallback);
      if (o.rateLimited) sawRateLimit = true;
      if (o.providerError) sawProviderError = true;
      if (o.result) return { ...o.result, attemptedModels: attempted.slice(0, -1) };
    }
  } else {
    for (let i = 0; i < list.length; i++) {
      const model = list[i]!;
      attempted.push(model);
      const o = await callOnce(model, role, opts, opts.backend, i === 0 ? tPrimary : tFallback);
      if (o.rateLimited) sawRateLimit = true;
      if (o.providerError) sawProviderError = true;
      if (o.result) {
        return {
          ...o.result,
          attemptedModels: attempted.length > 1 ? attempted.slice(0, -1) : [],
        };
      }
    }
  }

  const wantGroqFallback =
    !opts.backend &&
    env.aiLlmFallbackBackend === "groq" &&
    Boolean(env.groqApiKey) &&
    (sawRateLimit || sawProviderError);

  if (wantGroqFallback) {
    const groqModel = firstDefined(env.groqModel, process.env.GROQ_MODEL) ?? "llama-3.3-70b-versatile";
    attempted.push(`groq:${groqModel}`);
    const o = await callOnce(groqModel, role, opts, "groq", tFallback);
    if (o.result) {
      return { ...o.result, attemptedModels: attempted.slice(0, -1), usedBackendFallback: true };
    }
  }

  return null;
}
