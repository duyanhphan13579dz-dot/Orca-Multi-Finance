import { ok, badRequest, unavailable } from "@/lib/envelope";
import { getStockCompanyPackage } from "@/lib/services/stock-company";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/v1/stocks/:symbol/company
 * Hồ sơ doanh nghiệp + cổ đông lớn + (nếu có AI) swot / catalyst / chuỗi giá trị.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const sym = symbol?.trim().toUpperCase();
  if (!sym || sym.length > 12) return badRequest("Mã không hợp lệ");

  try {
    const r = await getStockCompanyPackage(sym);
    if (!r) return unavailable("vndirect", `Không lấy được hồ sơ doanh nghiệp cho ${sym}.`);
    return ok(
      {
        ...r.data,
        aiConfigured: r.data.notes.some((n) => n.includes("AI")),
      },
      {
        source: r.meta.source,
        sourceTimestamp: r.meta.sourceTimestamp,
        cached: r.meta.cached,
        stale: r.meta.stale,
        note: r.meta.note,
      },
    );
  } catch (e) {
    return unavailable("company", e instanceof Error ? e.message : "unknown");
  }
}
