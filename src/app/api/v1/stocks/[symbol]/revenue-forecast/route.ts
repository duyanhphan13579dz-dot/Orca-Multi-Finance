import { ok, badRequest, unavailable, fail } from "@/lib/envelope";
import { forecastRevenueAi } from "@/lib/services/financial-ai";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** GET /api/v1/stocks/[symbol]/revenue-forecast?horizons=4 */
export async function GET(req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const sym = symbol?.trim().toUpperCase();
  if (!sym || sym.length > 12) return badRequest("Mã không hợp lệ");

  const url = new URL(req.url);
  const horizons = Math.min(8, Math.max(1, Number(url.searchParams.get("horizons") ?? 4) || 4));

  try {
    const r = await forecastRevenueAi(sym, horizons);
    if (!r) return unavailable("revenue-forecast", `Không lấy được BCTC cho ${sym}.`);
    return ok(r.forecast, {
      source: r.meta.source,
      sourceTimestampMs: r.meta.sourceTimestamp ? Date.parse(r.meta.sourceTimestamp) : null,
      cached: r.meta.cached,
      stale: r.meta.stale,
      note: r.meta.note,
    });
  } catch (e) {
    return fail("REVENUE_FORECAST_FAILED", e instanceof Error ? e.message : "unknown", 502);
  }
}
