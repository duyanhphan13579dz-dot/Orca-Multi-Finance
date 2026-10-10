import { ok, badRequest, unavailable } from "@/lib/envelope";
import { getStockNews } from "@/lib/services/stock-news";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/v1/stocks/:symbol/news?limit=20
 * Tin doanh nghiệp theo mã: VNDirect DStock (tin-tuc-ma) + RSS bổ sung.
 */
export async function GET(req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol: raw } = await ctx.params;
  const symbol = (raw ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{3,12}$/.test(symbol)) return badRequest("symbol không hợp lệ");
  const limitRaw = Number(new URL(req.url).searchParams.get("limit") ?? 20);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 20;
  const r = await getStockNews(symbol, limit);
  if (!r) return unavailable("stock-news", `Không lấy được tin doanh nghiệp cho ${symbol}.`);
  return ok(r.data, r.meta, { "Cache-Control": "private, max-age=60, stale-while-revalidate=600" });
}
