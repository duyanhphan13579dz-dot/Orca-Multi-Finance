import { ok, unavailable, badRequest } from "@/lib/envelope";
import { getChartHistory } from "@/lib/services/chart";
import { tfsFor, type ChartAssetType } from "@/lib/chart-const";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * UNIFIED CHART DATA API — normalized candles + structured indicators for
 * every asset class (crypto / forex / stock), freshness + quality meta.
 *
 * GET /api/v1/chart/history?symbol=BTCUSDT&assetType=crypto&timeframe=1h&limit=300
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol") ?? "";
  const assetType = (url.searchParams.get("assetType") ?? "crypto") as ChartAssetType;
  const timeframe = url.searchParams.get("timeframe") ?? "1h";
  const limit = Number(url.searchParams.get("limit") ?? 300);

  if (!/^[A-Za-z0-9]{2,20}$/.test(symbol)) return badRequest("symbol không hợp lệ");
  if (!["crypto", "forex", "stock", "commodity", "metal"].includes(assetType)) return badRequest("assetType không hợp lệ");
  if (!tfsFor(assetType).includes(timeframe)) return badRequest(`timeframe không hỗ trợ cho ${assetType} (cho phép: ${tfsFor(assetType).join(", ")})`);
  if (!Number.isFinite(limit) || limit < 50 || limit > 1000) return badRequest("limit 50..1000");

  const r = await getChartHistory({ symbol, assetType, timeframe, limit });
  if (!r) {
    return unavailable(
      "chart-engine",
      assetType === "stock"
        ? "Dữ liệu chart cổ phiếu VN lấy từ VNDirect — UNAVAILABLE khi provider offline (không dùng dữ liệu giả)."
        : `Không lấy được candles ${symbol}/${timeframe} từ provider — xem /system.`,
    );
  }
  return ok(r.data, r.meta);
}
