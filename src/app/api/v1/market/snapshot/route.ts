import { ok, fail } from "@/lib/envelope";
import { buildMarketSnapshot } from "@/lib/services/market";
import { ensureHeartbeatStarted } from "@/lib/realtime/heartbeat";
import { ensureSessionPollerStarted } from "@/lib/realtime/session-poller";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    try {
      ensureHeartbeatStarted();
      ensureSessionPollerStarted();
    } catch {
      /* optional */
    }
    const { snapshot, meta } = await buildMarketSnapshot();
    return ok(snapshot, meta);
  } catch (e) {
    return fail("SNAPSHOT_FAILED", e instanceof Error ? e.message : "unknown", 502);
  }
}
