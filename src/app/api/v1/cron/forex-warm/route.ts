import { ok, unavailable } from "@/lib/envelope";
import { cronUnauthorized } from "@/lib/cron-auth";
import { runGuarded, guardMeta } from "@/lib/data-engine/workers-guard";
import { WORKERS_BUDGET } from "@/lib/data-engine/workers-budget";
import { putHot } from "@/lib/hot-snapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * P8a: focused forex hot-warm — never shares budget with board/intel.
 * GET /api/v1/cron/forex-warm?secret=...
 * Recommend every 45–60s (24/7).
 */
export async function GET(req: Request) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;

  const t0 = Date.now();
  try {
    const pack = await runGuarded(
      async () => {
        const { getForexMarkets } = await import("@/lib/services/forex");
        return getForexMarkets().catch(() => null);
      },
      {
        label: "cron-forex-warm",
        wallMs: WORKERS_BUDGET.cronDomainWallMs,
        maxSubrequests: WORKERS_BUDGET.cronMaxSubrequests,
        maxConcurrent: 2,
      },
    );

    if (!pack?.data?.rows?.length) {
      return unavailable("forex-warm", "Forex warm failed — last-good may still serve UI");
    }

    putHot("forex", pack.data, {
      source: pack.meta?.source ?? "forex-warm",
      partial: pack.meta?.partial,
      note: pack.meta?.note,
    });

    return ok(
      {
        ok: true,
        pairs: pack.data.rows.length,
        source: pack.meta?.source,
        durationMs: Date.now() - t0,
        guard: guardMeta(),
      },
      pack.meta,
      { "Cache-Control": "no-store" },
    );
  } catch (e) {
    return unavailable("forex-warm", e instanceof Error ? e.message : "forex warm error");
  }
}
