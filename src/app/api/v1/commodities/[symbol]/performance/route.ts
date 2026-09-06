import { ok, unavailable, badRequest } from "@/lib/envelope";
import { getCommodityPerformance } from "@/lib/services/commodities";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/commodities/:symbol/performance — 1D/1W/1M/1Q/1Y. */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const clean = symbol.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (!clean) return badRequest("symbol không hợp lệ");
  const r = await getCommodityPerformance(clean);
  if (!r) return badRequest(`Không biết hàng hóa "${clean}"`);
  return ok(r);
}
