import { env } from "@/lib/env";
import { ok } from "@/lib/envelope";
import { buildMeta } from "@/lib/freshness";
import { ssiWs, ensureSsiWsStarted } from "@/lib/realtime/ssi-ws";
import { bootSsiMarketDataPipeline } from "@/lib/realtime/ssi-market-boot";
import { ssiFcConfigured } from "@/lib/providers/ssi-fcdata";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/system/ssi-ws — trạng thái DataHub streaming (All api data + All stream data) */
export async function GET() {
  if (ssiFcConfigured() && !env.ssiWsDisabled) {
    bootSsiMarketDataPipeline();
  }
  const stats = ssiWs.getStats();
  return ok(
    {
      ...stats,
      pipeline: {
        rest: "fc-data.ssi.com.vn",
        stream: "fc-datahub.ssi.com.vn",
        scopesExpected: ["All api data", "All stream data"],
        note: "Trading scopes optional — market board không cần OTP",
      },
    },
    buildMeta({
      source: "ssi-ws",
      sourceTimestampMs: stats.lastMessageAt ?? Date.now(),
      note: stats.configured
        ? stats.enabled
          ? `SSI WS ${stats.state} · ${stats.channels.length} channel`
          : "SSI WS disabled (SSI_WS_DISABLED=true)"
        : "Chưa cấu hình SSI_API_KEY/SSI_API_SECRET (hoặc SSI_FC_CONSUMER_ID/SECRET)",
    }),
  );
}
