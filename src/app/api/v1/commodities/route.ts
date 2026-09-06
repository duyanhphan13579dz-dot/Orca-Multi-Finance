import { ok, unavailable } from "@/lib/envelope";
import { CATALOG, getCommodityMarket } from "@/lib/services/commodities";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const r = await getCommodityMarket();
  if (!r) {
    return unavailable(
      "commodity-providers",
      "Không có nguồn hàng hóa nào phản hồi (Simplize/Vietnambiz/Yahoo) — xem /system.",
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
        /** chart khả dụng khi có nguồn OHLC thật (Yahoo futures / PAXG) */
        hasChart: Boolean(c.yahooSymbol || c.binanceSymbol),
      })),
    },
    r.meta,
  );
}
