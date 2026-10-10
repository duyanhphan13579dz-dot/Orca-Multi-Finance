import { safeApi } from "@/lib/safe-api";
import { getCommodityMarket, GROUP_LABELS } from "@/lib/services/commodities";
import { getHot, putHot } from "@/lib/hot-snapshot";
import { WORKERS_BUDGET } from "@/lib/data-engine/workers-budget";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** P8c: user path ≤15s */
export const maxDuration = 15;

/** P8b: snapshot-first commodities via safeApi */
export async function GET() {
  return safeApi({
    label: "commodities",
    guard: {
      wallMs: WORKERS_BUDGET.apiWallMs,
      maxSubrequests: WORKERS_BUDGET.maxSubrequestsPerRequest,
      maxConcurrent: WORKERS_BUDGET.maxParallelProviders,
    },
    produce: async () => {
      const fresh = await getHot("commodities");
      if (fresh?.fresh && fresh.data) {
        return {
          data: fresh.data,
          meta: {
            ...fresh.meta,
            note: `hot-fresh commodities · ${Math.round(fresh.ageMs / 1000)}s`,
          },
          headers: {
            "Cache-Control": "private, max-age=20, stale-while-revalidate=90",
            "X-Orca-Hot": "fresh",
            "X-Orca-Mode": "hot",
          },
        };
      }

      const r = await getCommodityMarket();
      if (!r?.data?.rows?.length) return null;

      const catalog = r.data.catalog.map((c) => ({
        key: c.key,
        name: c.name,
        nameVi: c.nameVi,
        group: c.group,
        symbol: c.symbol,
        unit: c.unit,
        vnImpact: c.vnImpact ?? null,
      }));
      const data = {
        rows: r.data.rows,
        unavailable: r.data.unavailable,
        sourcesUsed: r.data.sourcesUsed,
        errors: r.data.errors,
        catalog,
        groups: GROUP_LABELS,
      };
      putHot("commodities", data, r.meta);
      return {
        data,
        meta: r.meta,
        headers: {
          "Cache-Control": "private, max-age=30, stale-while-revalidate=120",
          "X-Orca-Mode": "live",
        },
      };
    },
    fallback: async () => {
      const last = await getHot("commodities");
      if (last?.data) {
        return {
          data: last.data,
          meta: {
            ...last.meta,
            source: "commodities-last-good",
            cached: true,
            partial: true,
            stale: true,
            note: `Phục vụ last-good commodities · age ${Math.round(last.ageMs / 1000)}s`,
          },
        };
      }
      return {
        data: {
          rows: [],
          unavailable: [],
          sourcesUsed: [],
          errors: [],
          catalog: [],
          groups: GROUP_LABELS,
        },
        meta: {
          source: "commodities-shell",
          partial: true,
          stale: true,
          note: "Commodities shell — cron commodities-warm sẽ đổ đầy",
        },
      };
    },
    unavailableSource: "commodity-providers",
    unavailableNote: "VietnamBiz Data không phản hồi — xem /system.",
  });
}
