import { ok, unavailable, badRequest } from "@/lib/envelope";
import { getStockTechReco } from "@/lib/services/stock-tech-reco";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/stocks/:symbol/tech-reco
 * Quant technical synthesis + optional LLM narrative / stance.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const sym = (symbol ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym || sym.length > 12) return badRequest("symbol không hợp lệ");

  const r = await getStockTechReco(sym);
  if (!r) return unavailable("tech-reco", `Không tổng hợp được khuyến nghị kỹ thuật cho ${sym}`);
  return ok(r.data, r.meta);
}
