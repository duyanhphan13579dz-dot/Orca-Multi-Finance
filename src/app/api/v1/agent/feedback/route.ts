import { ok, badRequest, fail } from "@/lib/envelope";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/v1/agent/feedback
 * Body: { conversationId: string, rating: -1|0|1, reason?: string, correctedAnswer?: string }
 * Thu thập tín hiệu DPO cho huấn luyện
 */
export async function POST(req: Request) {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Đăng nhập để gửi feedback", 401);
  const body = (await req.json().catch(() => null)) as {
    conversationId?: string;
    rating?: number;
    reason?: string;
    correctedAnswer?: string;
  } | null;
  if (!body?.conversationId || typeof body.rating !== "number" || ![-1, 0, 1].includes(body.rating)) {
    return badRequest("conversationId và rating (-1|0|1) là bắt buộc");
  }
  const { logFeedback } = await import("@/lib/ai/training/collector");
  const okFb = await logFeedback({
    conversationId: body.conversationId,
    rating: body.rating as -1 | 0 | 1,
    reason: body.reason ?? null,
    correctedAnswer: body.correctedAnswer ?? null,
  });
  if (!okFb) return badRequest("Không lưu được feedback (conversation không tồn tại?)");
  return ok({ saved: true });
}

export async function GET() {
  return badRequest("Dùng POST");
}
