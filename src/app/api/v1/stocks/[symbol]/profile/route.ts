import { ok, unavailable } from "@/lib/envelope";
import { getStockCompanyPackage } from "@/lib/services/stock-company";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const r = await getStockCompanyPackage(symbol);
  if (!r) return unavailable("vndirect", `Không lấy được hồ sơ doanh nghiệp ${symbol.toUpperCase()}.`);
  return ok(r.data, r.meta);
}
