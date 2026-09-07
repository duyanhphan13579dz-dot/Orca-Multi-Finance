import { ok, unavailable } from "@/lib/envelope";
import { getCommodityMarket, GROUP_LABELS } from "@/lib/services/commodities";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const r = await getCommodityMarket();
  if (!r) {
    return unavailable(
      "commodity-providers",
      "VietnamBiz Data (data.vietnambiz.vn/goods) không phản hồi — xem /system.",
    );
  }
  const catalog = r.data.catalog.map((c) => ({
    key: c.key,
    name: c.name,
    nameVi: c.nameVi,
    group: c.group,
    symbol: c.symbol,
    unit: c.unit,
    vnImpact: c.vnImpact ?? null,
  }));
  return ok(
    {
      rows: r.data.rows,
      unavailable: r.data.unavailable,
      sourcesUsed: r.data.sourcesUsed,
      errors: r.data.errors,
      catalog,
      groups: GROUP_LABELS,
    },
    r.meta,
  );
}
