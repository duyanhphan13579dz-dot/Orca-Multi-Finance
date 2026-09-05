import { ok, unavailable } from "@/lib/envelope";
import { getVnStockDetail, vnstockConfigured } from "@/lib/services/stocks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  if (!vnstockConfigured()) return unavailable("vnstock", "VNSTOCK_API_KEY chưa được cấu hình.");
  const r = await getVnStockDetail(symbol);
  if (!r) return unavailable("vnstock", `Không lấy được báo cáo tài chính ${symbol.toUpperCase()} từ VNStock.`);
  return ok({ symbol: r.detail.symbol, financials: r.detail.financials, notes: r.detail.notes }, r.meta);
}
