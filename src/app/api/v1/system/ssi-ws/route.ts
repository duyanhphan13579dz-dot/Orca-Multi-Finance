import { ok } from "@/lib/envelope";
import { buildMeta } from "@/lib/freshness";
import { ssiWs, ensureSsiWsStarted } from "@/lib/realtime/ssi-ws";
import { ssiFcStream, ensureSsiFcStreamStarted } from "@/lib/realtime/ssi-fc-stream";
import { ssiFcConfigured } from "@/lib/providers/ssi-fcdata";
import { ssiFastConfigured } from "@/lib/providers/ssi-fastconnect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/system/ssi-ws — trạng thái streaming SSI (v3 FastConnect + legacy DataHub). */
export async function GET() {
  const v3 = ssiFastConfigured();
  const legacy = ssiFcConfigured();
  const wsOk = process.env.SSI_WS_DISABLED !== "true";

  if (wsOk) {
    if (v3) ensureSsiFcStreamStarted();
    else if (legacy) ensureSsiWsStarted();
  }

  const v3Stats = ssiFcStream.getStats();
  const legacyStats = legacy && !v3 ? ssiWs.getStats() : null;
  const active = v3 ? "ssi-fc-stream" : legacy ? "ssi-ws" : null;

  return ok(
    {
      active,
      ssiFcStream: v3Stats,
      ssiWsLegacy: legacyStats,
    },
    buildMeta({
      source: "ssi-ws",
      sourceTimestampMs: v3Stats.lastMessageAt ?? legacyStats?.lastMessageAt ?? Date.now(),
      note: !v3 && !legacy
        ? "Chưa cấu hình SSI (cần SSI_API_KEY/SECRET hoặc SSI_FC_CONSUMER_ID/SECRET)"
        : !wsOk
          ? "SSI WS disabled (SSI_WS_DISABLED=true)"
          : v3
            ? `SSI FastConnect v3 stream ${v3Stats.state} · ${v3Stats.topics.length} topic`
            : `SSI DataHub legacy ${legacyStats?.state ?? "?"}`,
    }),
  );
}
