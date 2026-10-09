import { ok, unavailable } from "@/lib/envelope";
import { getMultiAssetBoard } from "@/lib/services/multi-asset-board";
import { cronUnauthorized } from "@/lib/cron-auth";
import { runGuarded, guardMeta } from "@/lib/data-engine/workers-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 18;

/**
 * Warm BTC · ETH · XAU · XAG · FOREX board.
 * GET /api/v1/cron/multi-asset-warm?secret=...
 * Recommend every 60–90s (24/7).
 */
export async function GET(req: Request) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;

  const t0 = Date.now();
  try {
    const pack = await runGuarded(
      async () => getMultiAssetBoard().catch(() => null),
      {
        label: "cron-multi-asset-warm",
        wallMs: 14_000,
        maxSubrequests: 22,
        maxConcurrent: 3,
      },
    );

    if (!pack?.board.rows.length) {
      return unavailable("multi-asset-warm", "Multi-asset warm failed");
    }

    const { byClass, sources } = pack.board;
    return ok(
      {
        ok: true,
        count: pack.board.rows.length,
        crypto: byClass.crypto.map((r) => r.symbol),
        metal: byClass.metal.map((r) => r.symbol),
        forex: byClass.forex.map((r) => r.symbol),
        sources,
        durationMs: Date.now() - t0,
        guard: guardMeta(),
      },
      pack.meta,
      { "Cache-Control": "no-store" },
    );
  } catch (e) {
    return unavailable(
      "multi-asset-warm",
      e instanceof Error ? e.message : "warm error",
    );
  }
}
