import { ok, unavailable } from "@/lib/envelope";
import { CATALOG, getCommodityMarket } from "@/lib/services/commodities";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const r = await getCommodityMarket();
  if (!r) {
    return unavailable(
      "commodity-providers",
      "VietnamBiz không phản hồi hoặc không parse được bảng giá — xem /system.",
    );
  }
  return ok(
    {
      ...r.data,
      catalog: CATALOG.map((c) => ({
        key: c.key,
        name: c.name,
        nameVi: c.nameVi,
        group: c.group,
        symbol: c.symbol,
        unit: c.unit,
        vnImpact: c.vnImpact ?? null,
      })),
    },
    r.meta,
  );
}
