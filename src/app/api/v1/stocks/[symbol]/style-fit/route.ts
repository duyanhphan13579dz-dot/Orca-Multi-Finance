import { ok, unavailable } from "@/lib/envelope";
import { getStockStyleFit } from "@/lib/services/stock-style-fit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/stocks/:symbol/style-fit
 * Giải thích điều kiện đạt của Minervini Trend Template và CANSLIM.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const normalized = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!normalized) return unavailable("style-fit", "Mã cổ phiếu không hợp lệ.");

  try {
    const result = await getStockStyleFit(normalized);
    if (!result.minervini && !result.canslim) {
      return unavailable("style-fit", result.notes.join(" ") || `Chưa đủ dữ liệu để đánh giá ${normalized}.`);
    }
    return ok(result, {
      source: "minervini-canslim-style-fit",
      sourceTimestampMs: Date.now(),
      hasData: true,
      partial: result.notes.length > 0,
      note: "Điều kiện nghiên cứu, không phải tín hiệu giao dịch.",
    });
  } catch {
    return unavailable("style-fit", `Tạm thời chưa đánh giá được Minervini/CANSLIM cho ${normalized}.`);
  }
}
