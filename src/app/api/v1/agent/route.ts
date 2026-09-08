import { ok, badRequest, fail } from "@/lib/envelope";
import { answerQuestion, type AgentHistoryTurn } from "@/lib/services/agent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * ORCA AI Agent — fetch-data-first reasoning over live platform data.
 * POST { question: string, history?: { role, content }[], preferences? }
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    question?: string;
    history?: AgentHistoryTurn[];
    preferences?: {
      depth?: "concise" | "standard" | "deep";
      style?: "analyst" | "technical" | "brief";
      language?: "vi" | "en";
      riskDisclosure?: "standard" | "detailed" | "off";
    };
  } | null;

  const question = body?.question?.trim();
  if (!question || question.length < 3) return badRequest("Câu hỏi quá ngắn");
  if (question.length > 800) return badRequest("Câu hỏi quá dài (tối đa 800 ký tự)");

  const history = Array.isArray(body?.history)
    ? body!.history
        .filter((h) => h && (h.role === "user" || h.role === "assistant" || h.role === "agent") && typeof h.content === "string")
        .map((h) => ({
          role: (h.role === "agent" ? "assistant" : h.role) as "user" | "assistant",
          content: String(h.content).slice(0, 2_500),
        }))
        .slice(-10)
    : [];

  try {
    const { result, meta } = await answerQuestion(question, body?.preferences ?? {}, history);
    return ok(result, meta);
  } catch (e) {
    return fail("AGENT_FAILED", e instanceof Error ? e.message : "unknown", 502);
  }
}
