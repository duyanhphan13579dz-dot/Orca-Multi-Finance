import { ok, fail } from "@/lib/envelope";
import { buildMarketSnapshot } from "@/lib/services/market";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Producers budget ~3s each in parallel — keep under serverless soft limit. */
export const maxDuration = 15;

export async function GET() {
  try {
    // Warm realtime in background — never block first byte
    void import("@/lib/realtime/heartbeat")
      .then((m) => m.ensureHeartbeatStarted())
      .catch(() => undefined);
    void import("@/lib/realtime/session-poller")
      .then((m) => m.ensureSessionPollerStarted())
      .catch(() => undefined);

    const { snapshot, meta } = await buildMarketSnapshot();
    return ok(snapshot, meta, {
      "Cache-Control": meta.stale
        ? "private, max-age=5, stale-while-revalidate=60"
        : "private, max-age=15, stale-while-revalidate=45",
    });
  } catch (e) {
    return fail("SNAPSHOT_FAILED", e instanceof Error ? e.message : "unknown", 502);
  }
}
