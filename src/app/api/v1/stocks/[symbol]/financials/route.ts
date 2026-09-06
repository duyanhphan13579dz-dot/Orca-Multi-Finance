import { ok, unavailable } from "@/lib/envelope";
import { getVnEquityDetail, vndirectConfigured } from "@/lib/services/stocks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  if (!vndirectConfigured()) return unavailable("vndirect", "VNDirect chưa khả dụng lần này.");
  const r = await getVnEquityDetail(symbol);
  if (!r) return unavailable("vndirect", `Không lấy được báo cáo tài chính ${symbol.toUpperCase()} từ VNDirect.`);
  return ok({ symbol: r.detail.symbol, financials: r.detail.financials, notes: r.detail.notes }, r.meta);
}
