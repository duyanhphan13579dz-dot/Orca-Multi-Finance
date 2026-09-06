import { ok, badRequest } from "@/lib/envelope";
import { getCommodityImpact } from "@/lib/services/commodities";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/commodities/:symbol/impact — impact matrix (evidence-based):
 * relationshipType ∈ INPUT_COST/REVENUE_DRIVER/SELLING_PRICE/INVENTORY/
 * TRADING/HEDGE/CAPEX/MACRO_SENSITIVITY/INDIRECT; direction ∈ POSITIVE/
 * NEGATIVE/MIXED/CONDITIONAL; impactStrength ∈ HIGH/MEDIUM/LOW.
 * ECONOMIC EXPOSURE vs RELATED-SOURCE được tách rõ; correlation không dùng
 * làm bằng chứng nhân quả.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const clean = symbol.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (!clean) return badRequest("symbol không hợp lệ");
  const r = await getCommodityImpact(clean);
  if (!r) return badRequest(`Không biết hàng hóa "${clean}"`);
  return ok({ rows: r.rows, note: r.note });
}
