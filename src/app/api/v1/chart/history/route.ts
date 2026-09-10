import { ok, unavailable, badRequest } from "@/lib/envelope";
import { getChartHistory } from "@/lib/services/chart";
import { tfsFor, type ChartAssetType } from "@/lib/chart-const";
import { vnStockTimeframes } from "@/lib/services/stocks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * UNIFIED CHART DATA API — normalized candles + structured indicators.
 * Crypto: up to 5000 bars (paged Binance klines).
 * Forex / stock / commodity: up to 2000 bars (provider-dependent depth).
 *
 * GET /api/v1/chart/history?symbol=BTCUSDT&assetType=crypto&timeframe=1h&limit=2500
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol") ?? "";
  const assetType = (url.searchParams.get("assetType") ?? "crypto") as ChartAssetType;
  const timeframe = url.searchParams.get("timeframe") ?? "1h";
  const rawLimit = Number(url.searchParams.get("limit") ?? 500);
  const maxLimit = assetType === "crypto" ? 5000 : 2000;

  if (!/^[A-Za-z0-9]{2,20}$/.test(symbol)) return badRequest("symbol không hợp lệ");
  if (!["crypto", "forex", "stock", "commodity"].includes(assetType)) return badRequest("assetType không hợp lệ");
  const allowed = assetType === "stock" ? vnStockTimeframes() : tfsFor(assetType);
  if (!allowed.includes(timeframe))
    return badRequest(`timeframe không hỗ trợ cho ${assetType} (cho phép: ${allowed.join(", ")})`);
  if (!Number.isFinite(rawLimit) || rawLimit < 50 || rawLimit > maxLimit)
    return badRequest(`limit 50..${maxLimit}`);

  const r = await getChartHistory({ symbol, assetType, timeframe, limit: rawLimit });
  if (!r) {
    return unavailable(
      "chart-engine",
      assetType === "stock"
        ? timeframe !== "1d" && timeframe !== "1w" && timeframe !== "1M"
          ? `Nến intraday VN cần SSI FastConnect v3 (set SSI_API_KEY + SSI_API_SECRET) — xem /system.`
          : "Không lấy được chuỗi nến chỉ số/cổ phiếu VN từ SSI/VNDirect — thử lại hoặc xem /system."
        : `Không lấy được candles ${symbol}/${timeframe} từ provider — xem /system.`,
    );
  }
  return ok(r.data, r.meta);
}
