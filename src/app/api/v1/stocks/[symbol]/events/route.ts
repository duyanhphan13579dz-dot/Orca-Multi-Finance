import { ok, badRequest, unavailable } from "@/lib/envelope";
import { getStockCorporateEvents } from "@/lib/services/stock-events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/stocks/:symbol/events?type=DIVIDEND&size=40
 * Corporate events + dividends from VNDirect /v4/events.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ symbol: string }> },
) {
  const { symbol: raw } = await ctx.params;
  const symbol = (raw ?? "").trim().toUpperCase();
  if (!symbol || !/^[A-Z0-9]{3,12}$/.test(symbol)) {
    return badRequest("symbol không hợp lệ");
  }

  const url = new URL(req.url);
  const type = url.searchParams.get("type")?.trim() || undefined;
  const sizeRaw = Number(url.searchParams.get("size") ?? 40);
  const size = Number.isFinite(sizeRaw) ? Math.min(Math.max(sizeRaw, 1), 100) : 40;

  const result = await getStockCorporateEvents(symbol, { size, type });
  if (!result) {
    return unavailable(
      "vndirect-events",
      `Không lấy được sự kiện doanh nghiệp cho ${symbol}.`,
    );
  }
  return ok(result.data, result.meta, {
    "Cache-Control": "private, max-age=60, stale-while-revalidate=600",
  });
}
