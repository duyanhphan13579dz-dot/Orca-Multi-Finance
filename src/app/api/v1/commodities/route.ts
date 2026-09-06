import { ok, unavailable } from "@/lib/envelope";
import { CATALOG, getCommodityMarket } from "@/lib/services/commodities";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const r = await getCommodityMarket();
  if (!r) {
    return unavailable(
      "commodity-providers",
      "Không có nguồn hàng hóa nào phản hồi (VietnamBiz Data — data.vietnambiz.vn) — xem /system.",
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
        category: c.category,
        subcategory: c.subcategory ?? null,
        symbol: c.symbol,
        unit: c.unit,
        vnImpact: c.vnImpact ?? null,
        /** WiFeed /goods KHÔNG có OHLC lịch sử → không chart (nguồn duy nhất) */
        hasChart: false as const,
      })),
    },
    r.meta,
  );
}
