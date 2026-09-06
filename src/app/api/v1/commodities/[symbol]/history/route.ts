import { ok, unavailable, badRequest } from "@/lib/envelope";
import { getCommodityHistory } from "@/lib/services/commodities";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/commodities/:symbol/history?timeframe=1d&limit=250
 * Normalized real history: { symbol, timestamp, open, high, low, close,
 * volume, source, priceType }. CLOSE_ONLY when provider gives closes only.
 */
export async function GET(req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const clean = symbol.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  const url = new URL(req.url);
  const timeframe = url.searchParams.get("timeframe") ?? "1d";
  const limit = Number(url.searchParams.get("limit") ?? 250);
  if (!clean) return badRequest("symbol không hợp lệ");
  if (!["1h", "4h", "1d", "1w", "1M"].includes(timeframe)) return badRequest("timeframe cho phép: 1h, 4h, 1d, 1w, 1M");
  if (!Number.isFinite(limit) || limit < 10 || limit > 1000) return badRequest("limit 10..1000");
  const r = await getCommodityHistory(clean, { timeframe, limit });
  if (!r) return unavailable("commodity-history", `Không có lịch sử thực cho ${clean} — nguồn thật (Yahoo futures, cùng ticker Simplize) chưa khả dụng.`);
  return ok(r);
}
