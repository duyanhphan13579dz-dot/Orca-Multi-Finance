import "server-only";

/**
 * Tầng 2 — Thu thập dữ liệu đa ngữ cảnh cho huấn luyện
 * Ghi mọi turn của ORCA Agent vào DB để làm nguyên liệu SFT/DPO/RAG
 */

export interface LogConversationParams {
  userId?: string | null;
  sessionId?: string | null;
  question: string;
  answer: string;
  intent: string;
  persona: string;
  mode: "deterministic" | "llm";
  model?: string | null;
  context?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  latencyMs?: number | null;
}

export async function logConversation(p: LogConversationParams): Promise<string | null> {
  try {
    const { db } = await import("@/db");
    const { agentConversations } = await import("@/db/schema");
    const [row] = await db.insert(agentConversations).values({
      userId: p.userId ?? null,
      sessionId: p.sessionId ?? null,
      question: p.question.slice(0, 800),
      answer: p.answer.slice(0, 8000),
      intent: p.intent,
      persona: p.persona,
      mode: p.mode,
      model: p.model ?? null,
      context: p.context as unknown as Record<string, unknown>,
      meta: p.meta as unknown as Record<string, unknown>,
      latencyMs: p.latencyMs ?? null,
    }).returning({ id: agentConversations.id });
    return row?.id ?? null;
  } catch {
    return null;
  }
}

export async function logFeedback(params: {
  conversationId: string;
  userId?: string | null;
  rating: -1 | 0 | 1;
  reason?: string | null;
  correctedAnswer?: string | null;
}): Promise<boolean> {
  try {
    const { db } = await import("@/db");
    const { agentFeedback } = await import("@/db/schema");
    await db.insert(agentFeedback).values({
      conversationId: params.conversationId,
      userId: params.userId ?? null,
      rating: params.rating,
      reason: params.reason ?? null,
      correctedAnswer: params.correctedAnswer?.slice(0, 8000) ?? null,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Truy vấn log cho training — filter theo persona/intent/rating
 */
export async function fetchTrainingLogs(opts: {
  limit?: number;
  intent?: string;
  persona?: string;
  sinceDays?: number;
  minRating?: number;
} = {}) {
  try {
    const { db } = await import("@/db");
    const { agentConversations, agentFeedback } = await import("@/db/schema");
    const { desc, gte, eq, sql } = await import("drizzle-orm");
    const limit = Math.min(opts.limit ?? 500, 2000);
    // đơn giản: lấy conversations, join feedback nếu có
    const rows = await db.select().from(agentConversations)
      .orderBy(desc(agentConversations.createdAt))
      .limit(limit);
    // filter in-memory để giữ query đơn giản (tránh phức tạp SQL cho prototype)
    let filtered = rows;
    if (opts.intent) filtered = filtered.filter(r => r.intent === opts.intent);
    if (opts.persona) filtered = filtered.filter(r => r.persona === opts.persona);
    if (opts.sinceDays) {
      const cutoff = Date.now() - opts.sinceDays * 86400000;
      filtered = filtered.filter(r => new Date(r.createdAt).getTime() >= cutoff);
    }
    return filtered;
  } catch {
    return [];
  }
}
