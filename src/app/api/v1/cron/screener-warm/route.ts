import { ok, unavailable } from "@/lib/envelope";
import { cronUnauthorized } from "@/lib/cron-auth";
import { runGuarded, guardMeta } from "@/lib/data-engine/workers-guard";
import { WORKERS_BUDGET } from "@/lib/data-engine/workers-budget";
import { putHot } from "@/lib/hot-snapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 18;

/**
 * P8a: focused screener warm (fundamental + valuation default scans).
 * GET /api/v1/cron/screener-warm?secret=...
 * Recommend every 2–3 min; prefer off-hours for larger universes.
 */
export async function GET(req: Request) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;

  const t0 = Date.now();
  const results: Record<string, { ok: boolean; ms: number; note?: string }> = {};

  // fundamental
  {
    const s = Date.now();
    try {
      const pack = await runGuarded(
        async () => {
          const { screenFundamental } = await import("@/lib/services/fundamental-screener");
          return screenFundamental({ limit: 40 }).catch(() => null);
        },
        {
          label: "cron-screener-fundamental",
          wallMs: Math.min(8_000, WORKERS_BUDGET.cronDomainWallMs),
          maxSubrequests: 14,
          maxConcurrent: 2,
        },
      );
      if (pack?.rows?.length) {
        putHot(
          "screener-fundamental",
          { rows: pack.rows, scanned: pack.scanned, skipped: pack.skipped, withData: pack.withData },
          {
            source: pack.meta?.source ?? "fundamental-warm",
            partial: pack.meta?.partial,
            note: pack.meta?.note,
          },
        );
        results.fundamental = { ok: true, ms: Date.now() - s, note: `${pack.rows.length} rows` };
      } else {
        results.fundamental = { ok: false, ms: Date.now() - s, note: "empty" };
      }
    } catch (e) {
      results.fundamental = { ok: false, ms: Date.now() - s, note: e instanceof Error ? e.message : "err" };
    }
  }

  // valuation
  {
    const s = Date.now();
    try {
      const pack = await runGuarded(
        async () => {
          const { screenValuation } = await import("@/lib/services/valuation-screener");
          return screenValuation({ limit: 40 }).catch(() => null);
        },
        {
          label: "cron-screener-valuation",
          wallMs: Math.min(8_000, WORKERS_BUDGET.cronDomainWallMs),
          maxSubrequests: 14,
          maxConcurrent: 2,
        },
      );
      if (pack?.rows?.length) {
        putHot(
          "screener-valuation",
          { rows: pack.rows, scanned: pack.scanned, skipped: pack.skipped, withData: pack.withData },
          {
            source: pack.meta?.source ?? "valuation-warm",
            partial: pack.meta?.partial,
            note: pack.meta?.note,
          },
        );
        results.valuation = { ok: true, ms: Date.now() - s, note: `${pack.rows.length} rows` };
      } else {
        results.valuation = { ok: false, ms: Date.now() - s, note: "empty" };
      }
    } catch (e) {
      results.valuation = { ok: false, ms: Date.now() - s, note: e instanceof Error ? e.message : "err" };
    }
  }

  const okCount = Object.values(results).filter((r) => r.ok).length;
  if (!okCount) {
    return unavailable("screener-warm", "Không warm được screener nào");
  }

  return ok(
    {
      ok: true,
      warmed: okCount,
      results,
      durationMs: Date.now() - t0,
      guard: guardMeta(),
    },
    { source: "screener-warm", note: `${okCount} slots` },
    { "Cache-Control": "no-store" },
  );
}
