import { ok } from "@/lib/envelope";
import { buildMeta } from "@/lib/freshness";
import { ssiWs, ensureSsiWsStarted } from "@/lib/realtime/ssi-ws";
import { ssiFcConfigured } from "@/lib/providers/ssi-fcdata";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/system/ssi-ws — trạng thái DataHub streaming */
export async function GET() {
  if (ssiFcConfigured() && process.env.SSI_WS_DISABLED !== "true") {
    ensureSsiWsStarted();
  }
  const stats = ssiWs.getStats();
  return ok(
    stats,
    buildMeta({
      source: "ssi-ws",
      sourceTimestampMs: stats.lastMessageAt ?? Date.now(),
      note: stats.configured
        ? stats.enabled
          ? `SSI WS ${stats.state} · ${stats.channels.length} channel`
          : "SSI WS disabled (SSI_WS_DISABLED=true)"
        : "Chưa cấu hình SSI_FC_CONSUMER_ID/SECRET",
    }),
  );
}
