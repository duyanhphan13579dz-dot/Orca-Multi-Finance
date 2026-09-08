import { ok, unavailable } from "@/lib/envelope";
import { getVnStockDetail } from "@/lib/services/stocks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const r = await getVnStockDetail(symbol);
  if (!r) {
    return unavailable(
      "vndirect",
      `Không lấy được dữ liệu ${symbol.toUpperCase()} từ VNDirect — xem /system để biết trạng thái provider.`,
    );
  }
  return ok(r.detail, r.meta);
}
