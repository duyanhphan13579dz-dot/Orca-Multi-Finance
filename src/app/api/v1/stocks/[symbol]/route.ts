import { ok, unavailable } from "@/lib/envelope";
import { getVnStockDetail, vnstockConfigured } from "@/lib/services/stocks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  if (!vnstockConfigured()) {
    return unavailable("vnstock", "VNSTOCK_API_KEY chưa được cấu hình — không thể truy xuất dữ liệu cổ phiếu thật.");
  }
  const r = await getVnStockDetail(symbol);
  if (!r) return unavailable("vnstock", `Không lấy được dữ liệu ${symbol.toUpperCase()} từ VNStock — xem /system để biết trạng thái provider.`);
  return ok(r.detail, r.meta);
}
