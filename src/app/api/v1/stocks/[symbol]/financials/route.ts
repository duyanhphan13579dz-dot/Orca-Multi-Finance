import { ok, unavailable } from "@/lib/envelope";
import { getFinancialsForSymbol } from "@/lib/financial/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/stocks/:symbol/financials
 *
 * Trang BÁO CÁO TÀI CHÍNH (hiển thị bảng BCTC).
 * Độc lập với pipeline định giá / phân tích cơ bản
 * (`/valuation`, `/fundamentals` kéo BCTC trực tiếp qua fundamental-valuation).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const r = await getFinancialsForSymbol(symbol);
  if (!r || (!r.financials.income && !r.financials.balance && !r.financials.cashflow)) {
    return unavailable(
      "financial-reports",
      `Không lấy được báo cáo tài chính ${symbol.toUpperCase()} để hiển thị bảng (VNDirect). Định giá vẫn có thể chạy độc lập qua /valuation.`,
    );
  }
  return ok(
    {
      symbol: symbol.toUpperCase(),
      financials: r.financials,
      health: r.health,
      packageMeta: r.packageMeta,
      notes: r.notes,
      purpose: "reports-page",
    },
    r.meta,
  );
}
