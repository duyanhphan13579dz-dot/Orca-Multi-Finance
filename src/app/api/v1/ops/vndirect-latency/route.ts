import { getVndirectLatencyStats } from "@/lib/providers/vndirect";
import { ensureVndirectWsStarted, vndirectWs } from "@/lib/realtime/vndirect-ws";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/ops/vndirect-latency
 * Rolling VNDirect REST latency (p50/p95) + WS getStats(). No secrets.
 */
export async function GET() {
  let ws: Record<string, unknown> = { started: false };
  try {
    if (process.env.VNDIRECT_WS_DISABLED !== "true") {
      ensureVndirectWsStarted();
      ws = { started: true, ...vndirectWs.getStats() };
    } else {
      ws = { started: false, reason: "VNDIRECT_WS_DISABLED" };
    }
  } catch (e) {
    ws = { started: false, error: e instanceof Error ? e.message : "ws_error" };
  }

  const rest = getVndirectLatencyStats();
  return Response.json({
    success: true,
    data: {
      rest,
      ws,
      tips:
        rest.p95Ms != null && rest.p95Ms > 3000
          ? "p95 REST cao — kiểm tra mạng tới api-finfo.vndirect.com.vn hoặc rate limit"
          : undefined,
    },
  });
}
