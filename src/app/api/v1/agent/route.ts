import { ok, badRequest, fail } from "@/lib/envelope";
import { answerQuestion, type AgentHistoryTurn } from "@/lib/services/agent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Vercel serverless budget — keep under this for cascade + data-engine */
export const maxDuration = 60;

/**
 * ORCA AI Agent — fetch-data-first reasoning over live platform data.
 * POST { question: string, history?: { role, content }[], preferences? }
 *
 * Always returns JSON (never hangs naked): degraded answer if LLM/data fails.
 */
export async function POST(req: Request) {
  let body: {
    question?: string;
    history?: AgentHistoryTurn[];
    preferences?: {
      depth?: "concise" | "standard" | "deep";
      style?: "analyst" | "technical" | "brief";
      language?: "vi" | "en";
      riskDisclosure?: "standard" | "detailed" | "off";
    };
  } | null = null;

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return badRequest("Body JSON không hợp lệ");
  }

  const question = body?.question?.trim();
  if (!question || question.length < 3) return badRequest("Câu hỏi quá ngắn");
  if (question.length > 800) return badRequest("Câu hỏi quá dài (tối đa 800 ký tự)");

  const history = Array.isArray(body?.history)
    ? body!.history
        .filter(
          (h) =>
            h &&
            (h.role === "user" || h.role === "assistant" || h.role === "agent") &&
            typeof h.content === "string",
        )
        .map((h) => ({
          role: (h.role === "agent" ? "assistant" : h.role) as "user" | "assistant",
          content: String(h.content).slice(0, 2_500),
        }))
        .slice(-20)
    : [];

  try {
    const { result, meta } = await answerQuestion(question, body?.preferences ?? {}, history);
    return ok(result, meta);
  } catch (e) {
    // answerQuestion already degrades internally — this is last-resort
    const msg = e instanceof Error ? e.message : "unknown";
    return fail(
      "AGENT_FAILED",
      `Agent tạm thời không phản hồi (${msg.slice(0, 160)}). Thử lại sau vài giây.`,
      503,
    );
  }
}
