import { ok, unavailable } from "@/lib/envelope";
import { getCommodityMarket, GROUP_LABELS } from "@/lib/services/commodities";
import { getHot, putHot } from "@/lib/hot-snapshot";
import { buildMeta } from "@/lib/freshness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

export async function GET() {
  try {
    const r = await getCommodityMarket();
    if (r) {
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
      return ok(data, r.meta, {
        "Cache-Control": "private, max-age=30, stale-while-revalidate=120",
      });
    }
  } catch {
    /* fall through to last-good */
  }

  const last = await getHot<{
    rows: unknown[];
    unavailable: unknown;
    sourcesUsed: unknown;
    errors: unknown;
    catalog: unknown;
    groups: unknown;
  }>("commodities");
  if (last) {
    return ok(
      last.data,
      buildMeta({
        source: "commodities-last-good",
        cached: true,
        partial: true,
        stale: true,
        note: `Phục vụ last-good commodities · age ${Math.round(last.ageMs / 1000)}s`,
      }),
      { "Cache-Control": "private, max-age=10, stale-while-revalidate=60" },
    );
  }

  return unavailable(
    "commodity-providers",
    "VietnamBiz Data (data.vietnambiz.vn/goods) không phản hồi — xem /system.",
  );
}
