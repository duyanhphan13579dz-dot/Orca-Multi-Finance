import { ok, unavailable } from "@/lib/envelope";
import { getVnMarketBoard } from "@/lib/services/stocks";
import { ensureHeartbeatStarted } from "@/lib/realtime/heartbeat";
import { ensureSessionPollerStarted } from "@/lib/realtime/session-poller";
import { getVnSession } from "@/lib/vn/sessions";
import { cronUnauthorized } from "@/lib/cron-auth";
import { runGuarded, guardMeta } from "@/lib/data-engine/workers-guard";
import { WORKERS_BUDGET } from "@/lib/data-engine/workers-budget";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

/**
 * High-frequency VN market warm — every 1–2 min during session.
 * Board-only sequential (no parallel indices+quotes race) to stay under 1102.
 *
 * GET /api/v1/cron/market-live?secret=...
 */
export async function GET(req: Request) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;

  const t0 = Date.now();
  const session = getVnSession();
  try {
    ensureHeartbeatStarted();
    ensureSessionPollerStarted();
  } catch {
    /* */
  }

  try {
    const board = await runGuarded(
      async () => getVnMarketBoard().catch(() => null),
      {
        label: "cron-market-live",
        wallMs: WORKERS_BUDGET.boardWallMs,
        maxSubrequests: 20,
        maxConcurrent: 2,
      },
    );

    const quotes = board?.quotes?.length ?? 0;
    const idxs = board?.indices?.length ?? 0;
    if (!quotes && !idxs) {
      return unavailable("vn-market-live", "Không refresh được bảng giá / chỉ số.");
    }

    return ok({
      ok: true,
      session: session.state,
      trading: session.trading,
      quotes,
      indices: idxs,
      universe: board?.universeSize ?? quotes,
      sessionDate: board?.sessionDate ?? null,
      source: board?.meta?.source,
      durationMs: Date.now() - t0,
      guard: guardMeta(),
    });
  } catch (e) {
    return unavailable(
      "vn-market-live",
      e instanceof Error ? e.message : "market-live failed",
    );
  }
}
