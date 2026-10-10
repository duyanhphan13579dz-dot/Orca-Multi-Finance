import { ok, unavailable } from "@/lib/envelope";
import { cronUnauthorized } from "@/lib/cron-auth";
import { runGuarded, guardMeta } from "@/lib/data-engine/workers-guard";
import { WORKERS_BUDGET } from "@/lib/data-engine/workers-budget";
import { putHot } from "@/lib/hot-snapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * P8a: focused commodities hot-snapshot warm (lighter than daily full refresh).
 * GET /api/v1/cron/commodities-warm?secret=...
 * Recommend every 2–5 min.
 */
export async function GET(req: Request) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;

  const t0 = Date.now();
  try {
    const pack = await runGuarded(
      async () => {
        const { getCommodityMarket, GROUP_LABELS } = await import("@/lib/services/commodities");
        const r = await getCommodityMarket().catch(() => null);
        if (!r?.data?.rows?.length) return null;
        return { r, GROUP_LABELS };
      },
      {
        label: "cron-commodities-warm",
        wallMs: Math.min(12_000, WORKERS_BUDGET.cronDomainWallMs),
        maxSubrequests: 14,
        maxConcurrent: 2,
      },
    );

    if (!pack?.r?.data?.rows?.length) {
      return unavailable("commodities-warm", "Commodities warm empty — last-good may still serve UI");
    }

    const { r, GROUP_LABELS } = pack;
    const catalog = r.data.catalog.map((c) => ({
      key: c.key,
      name: c.name,
      nameVi: c.nameVi,
      group: c.group,
      symbol: c.symbol,
      unit: c.unit,
      vnImpact: c.vnImpact ?? null,
    }));
    putHot(
      "commodities",
      {
        rows: r.data.rows,
        unavailable: r.data.unavailable,
        sourcesUsed: r.data.sourcesUsed,
        errors: r.data.errors,
        catalog,
        groups: GROUP_LABELS,
      },
      {
        source: r.meta?.source ?? "commodities-warm",
        partial: r.meta?.partial,
        note: r.meta?.note,
      },
    );

    return ok(
      {
        ok: true,
        rows: r.data.rows.length,
        durationMs: Date.now() - t0,
        guard: guardMeta(),
      },
      r.meta,
      { "Cache-Control": "no-store" },
    );
  } catch (e) {
    return unavailable(
      "commodities-warm",
      e instanceof Error ? e.message : "commodities warm error",
    );
  }
}
