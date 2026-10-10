import { ok, unavailable } from "@/lib/envelope";
import { getMultiAssetBoard } from "@/lib/services/multi-asset-board";
import { cronUnauthorized } from "@/lib/cron-auth";
import { runGuarded, guardMeta } from "@/lib/data-engine/workers-guard";
import { WORKERS_BUDGET } from "@/lib/data-engine/workers-budget";
import { putHot } from "@/lib/hot-snapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * Warm BTC · ETH · XAU · XAG · FOREX board + putHot multi-asset.
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
        wallMs: WORKERS_BUDGET.cronDomainWallMs,
        maxSubrequests: WORKERS_BUDGET.cronMaxSubrequests,
        maxConcurrent: 2,
      },
    );

    if (!pack?.board.rows.length) {
      return unavailable("multi-asset-warm", "Multi-asset warm failed");
    }

    const data = {
      rows: pack.board.rows,
      byClass: pack.board.byClass,
      sources: pack.board.sources,
      count: pack.board.rows.length,
    };
    putHot("multi-asset", data, {
      source: pack.meta?.source ?? "multi-warm",
      partial: pack.meta?.partial,
    });

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
