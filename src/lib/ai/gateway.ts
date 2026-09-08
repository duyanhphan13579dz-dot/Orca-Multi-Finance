import "server-only";
import { env } from "../env";
import { httpJson } from "../http";

/**
 * LLM GATEWAY — model selection by task role, provider-agnostic.
 * Supports optional multi-turn history for conversation continuity.
 */

export type LlmRole = "reasoning" | "analysis" | "classification";

export interface LlmResult {
  text: string;
  model: string;
  role: LlmRole;
  latencyMs: number;
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

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
  const t0 = performance.now();

  const history = (opts.history ?? [])
    .filter((t) => t.content?.trim())
    .slice(-8)
    .map((t) => ({
      role: t.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: t.content.trim().slice(0, 2_500),
    }));

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: opts.system },
    ...history,
    { role: "user", content: opts.user },
  ];

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
      messages,
    }),
  });
  const text = res.data?.choices?.[0]?.message?.content;
  if (!res.ok || !text || !text.trim()) return null;
  return { text: text.trim(), model, role, latencyMs: Math.round(performance.now() - t0) };
}
