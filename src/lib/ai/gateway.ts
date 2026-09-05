import "server-only";
import { env } from "../env";
import { httpJson } from "../http";

/**
 * LLM GATEWAY — model selection by task role, provider-agnostic.
 * Swap models via env without touching business logic:
 *   AI_MODEL / AI_MODEL_REASONING / AI_MODEL_ANALYSIS / AI_MODEL_CLASSIFICATION
 *   AI_BASE_URL (OpenAI-compatible), AI_PROVIDER_KEY
 */

export type LlmRole = "reasoning" | "analysis" | "classification";

export interface LlmResult {
  text: string;
  model: string;
  role: LlmRole;
  latencyMs: number;
}

export function modelFor(role: LlmRole): string {
  return process.env[`AI_MODEL_${role.toUpperCase()}`]?.trim() ?? env.aiModel;
}

export function llmConfigured(): boolean {
  return Boolean(env.aiProviderKey);
}

export function llmRegistryInfo() {
  return {
    configured: llmConfigured(),
    baseUrl: env.aiBaseUrl,
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

type ChatResponse = { choices?: { message?: { content?: string } }[] };

export async function llmChat(role: LlmRole, opts: ChatOptions): Promise<LlmResult | null> {
  if (!env.aiProviderKey) return null;
  const model = modelFor(role);
  const t0 = performance.now();
  const res = await httpJson<ChatResponse>(`${env.aiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    provider: `llm:${role}`,
    method: "POST",
    timeoutMs: opts.timeoutMs ?? 28_000,
    retries: 0,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.aiProviderKey}` },
    body: JSON.stringify({
      model,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 900,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    }),
  });
  const text = res.data?.choices?.[0]?.message?.content;
  if (!res.ok || !text || !text.trim()) return null;
  return { text: text.trim(), model, role, latencyMs: Math.round(performance.now() - t0) };
}
