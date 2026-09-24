import { ok, badRequest, fail } from "@/lib/envelope";
import { runStockForecast } from "@/lib/services/stock-forecast";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/stocks/:symbol/forecast
 *
 * Dự báo BCTC (quý/năm) + dự phóng định giá cuối kỳ
 * (Forward P/E, PEG, Residual Income light).
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ symbol: string }> },
) {
  try {
    const { symbol: raw } = await ctx.params;
    const symbol = (raw ?? "").trim().toUpperCase();
    if (!symbol || !/^[A-Z0-9]{3,12}$/.test(symbol)) {
      return badRequest("symbol không hợp lệ (ví dụ FPT, VIC)");
    }

    const r = await runStockForecast(symbol);
    if (!r) {
      return fail(
        "FORECAST_UNAVAILABLE",
        `Không dựng được dự báo ${symbol} — thiếu BCTC hoặc symbol không hợp lệ.`,
        503,
      );
    }

    return ok(r.data, r.meta);
  } catch (e) {
    console.error("[stock-forecast]", e);
    return fail(
      "FORECAST_ERROR",
      e instanceof Error ? e.message : "forecast failed",
      500,
    );
  }
}
