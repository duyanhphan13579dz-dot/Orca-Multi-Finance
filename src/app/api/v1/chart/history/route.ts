import { ok, unavailable, badRequest } from "@/lib/envelope";
import { getChartHistory } from "@/lib/services/chart";
import { tfsFor, type ChartAssetType } from "@/lib/chart-const";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * UNIFIED CHART DATA API — normalized candles + structured indicators.
 * GET /api/v1/chart/history?symbol=VIC&assetType=stock&timeframe=1d&limit=800
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const assetType = (url.searchParams.get("assetType") ?? "crypto") as ChartAssetType;
  const timeframe = url.searchParams.get("timeframe") ?? "1h";
  const rawLimit = Number(url.searchParams.get("limit") ?? 200);
  // Stock: deeper daily history (up to ~8 năm phiên); crypto keeps high intraday caps
  const maxLimit = assetType === "crypto" ? 5000 : assetType === "stock" ? 2500 : 2000;
  const minLimit = assetType === "stock" ? 20 : 50;

  if (!symbol || symbol.length < 2 || symbol.length > 20) return badRequest("symbol không hợp lệ");
  if (!["crypto", "forex", "stock", "commodity"].includes(assetType))
    return badRequest("assetType không hợp lệ");
  if (!tfsFor(assetType).includes(timeframe))
    return badRequest(`timeframe không hỗ trợ cho ${assetType} (cho phép: ${tfsFor(assetType).join(", ")})`);
  if (!Number.isFinite(rawLimit) || rawLimit < minLimit || rawLimit > maxLimit)
    return badRequest(`limit ${minLimit}..${maxLimit}`);

  try {
    const r = await getChartHistory({ symbol, assetType, timeframe, limit: Math.floor(rawLimit) });
    if (!r || !r.data?.candles?.length) {
      return unavailable(
        "chart-engine",
        assetType === "stock"
          ? "Không lấy được chuỗi nến VN từ VNDirect — thử lại hoặc xem /system."
          : `Không lấy được candles ${symbol}/${timeframe} từ provider — xem /system.`,
      );
    }
    return ok(r.data, r.meta);
  } catch {
    return unavailable("chart-engine", "Lỗi tạm thời khi tải chart — đang kết nối lại VNDirect.");
  }
}
