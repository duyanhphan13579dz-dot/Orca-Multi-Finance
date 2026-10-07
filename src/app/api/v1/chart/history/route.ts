import { ok, unavailable, badRequest } from "@/lib/envelope";
import { getChartHistory } from "@/lib/services/chart";
import { tfsFor, type ChartAssetType } from "@/lib/chart-const";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * UNIFIED CHART DATA API — normalized candles + structured indicators.
 * GET /api/v1/chart/history?symbol=VIC&assetType=stock&timeframe=1d&limit=800
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").trim().toUpperCase();
  const assetType = (url.searchParams.get("assetType") ?? "stock") as ChartAssetType;
  const timeframe = url.searchParams.get("timeframe") ?? "1d";
  const rawLimit = Number(url.searchParams.get("limit") ?? "500");

  if (!symbol) return badRequest("Thiếu symbol");
  if (!["crypto", "forex", "stock", "commodity"].includes(assetType))
    return badRequest("assetType phải là crypto | forex | stock | commodity");
  if (!tfsFor(assetType).includes(timeframe))
    return badRequest(`timeframe không hỗ trợ cho ${assetType} (cho phép: ${tfsFor(assetType).join(", ")})`);
  if (!Number.isFinite(rawLimit) || rawLimit < 10 || rawLimit > 5000)
    return badRequest("limit phải trong khoảng 10–5000");

  try {
    const r = await getChartHistory({ symbol, assetType, timeframe, limit: Math.floor(rawLimit) });
    if (!r) {
      return unavailable(
        "chart",
        assetType === "stock"
          ? "Không lấy được chuỗi nến VN — thử timeframe khác hoặc xem /system."
          : assetType === "commodity"
            ? `Không lấy được candles ${symbol}/${timeframe} (Yahoo/futures) — thử 1D.`
            : assetType === "crypto"
              ? `Không lấy được candles ${symbol}/${timeframe} từ Binance — thử lại.`
              : `Không lấy được candles ${symbol}/${timeframe} từ provider.`,
      );
    }
    return ok(r.data, r.meta);
  } catch (e) {
    console.warn("[chart/history]", symbol, assetType, timeframe, e instanceof Error ? e.message : e);
    return unavailable("chart", e instanceof Error ? e.message : "Lỗi lấy dữ liệu chart");
  }
}
