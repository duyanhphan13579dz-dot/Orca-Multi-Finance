import { ok, badRequest, fail } from "@/lib/envelope";
import { runFinancialOrchestrator } from "@/lib/agents/orchestrator";
import type { AgentPrefs } from "@/lib/services/agent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * ORCA AI AGENT — compatibility endpoint.
 * POST /api/v1/agent { question, preferences? }
 * - Intent tài chính mới → Orchestrator (3 agent chuyên biệt + Tool Layer).
 * - Intent legacy (crypto/forex/commodity/vn-stock/market/news) → pipeline cũ,
 *   giữ NGUYÊN hành vi + response shape (compatibility layer).
 * - Profile financial memory được nạp tự động khi user đã đồng ý lưu.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    question?: string;
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
  try {
    const prefs: AgentPrefs = {
      depth: body?.preferences?.depth ?? "standard",
      style: body?.preferences?.style,
      language: body?.preferences?.language,
      riskDisclosure: body?.preferences?.riskDisclosure,
    };
    const { result, meta } = await runFinancialOrchestrator(question, prefs);
    return ok(result, meta);
  } catch (e) {
    return fail("AGENT_FAILED", e instanceof Error ? e.message : "unknown", 502);
  }
}

/** Liệt kê tool layer (để UI/đối tác khám phá khả năng, additive). */
export async function GET() {
  const { listTools } = await import("@/lib/agents/tools");
  return ok({ tools: listTools() }, { source: "orca-tool-layer" });
}
