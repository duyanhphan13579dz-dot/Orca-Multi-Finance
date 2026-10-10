import { ok, unavailable } from "@/lib/envelope";
import { cronUnauthorized } from "@/lib/cron-auth";
import { runGuarded, guardMeta } from "@/lib/data-engine/workers-guard";
import { WORKERS_BUDGET } from "@/lib/data-engine/workers-budget";
import { putHot } from "@/lib/hot-snapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * P8a: focused market-intel warm.
 * GET /api/v1/cron/intel-warm?secret=...
 * Recommend every 60–90s during session; 2–3 min off-hours.
 */
export async function GET(req: Request) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;

  const t0 = Date.now();
  try {
    const pack = await runGuarded(
      async () => {
        const { buildMarketIntel } = await import("@/lib/services/market-intel");
        return buildMarketIntel().catch(() => null);
      },
      {
        label: "cron-intel-warm",
        wallMs: WORKERS_BUDGET.cronDomainWallMs,
        maxSubrequests: WORKERS_BUDGET.cronMaxSubrequests,
        maxConcurrent: 2,
      },
    );

    if (!pack?.intel) {
      return unavailable("intel-warm", "Intel warm failed — last-good may still serve UI");
    }

    putHot("intel", pack.intel, {
      source: pack.meta?.source ?? "intel-warm",
      partial: pack.meta?.partial,
      note: pack.meta?.note,
    });

    return ok(
      {
        ok: true,
        source: pack.meta?.source,
        durationMs: Date.now() - t0,
        guard: guardMeta(),
      },
      pack.meta,
      { "Cache-Control": "no-store" },
    );
  } catch (e) {
    return unavailable("intel-warm", e instanceof Error ? e.message : "intel warm error");
  }
}
