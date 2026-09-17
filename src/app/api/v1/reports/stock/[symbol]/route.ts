import { ok, unavailable, badRequest } from "@/lib/envelope";
import { generateCompanyAnalysisReport } from "@/lib/services/company-analysis-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 90;

/**
 * GET /api/v1/reports/stock/:symbol
 * Báo cáo phân tích doanh nghiệp chi tiết (Company Report).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol: raw } = await ctx.params;
  const symbol = (raw ?? "").trim().toUpperCase();
  if (!symbol || !/^[A-Z0-9]{3,12}$/.test(symbol)) {
    return badRequest("Mã cổ phiếu không hợp lệ");
  }

  try {
    const r = await generateCompanyAnalysisReport(symbol);
    if (!r) {
      return unavailable(
        "company-report",
        `Không tạo được báo cáo phân tích cho ${symbol}. Thử lại hoặc kiểm tra mã.`,
      );
    }
    return ok(r.report, r.meta);
  } catch (e) {
    console.error("[company-report]", e);
    return unavailable(
      "company-report",
      e instanceof Error ? e.message : `Lỗi dựng báo cáo ${symbol}`,
    );
  }
}
