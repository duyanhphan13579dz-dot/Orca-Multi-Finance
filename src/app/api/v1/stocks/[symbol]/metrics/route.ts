import { ok, badRequest, unavailable } from "@/lib/envelope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 45;

/**
 * GET /api/v1/stocks/:symbol/metrics
 * Multi-source quote + BCTC + full detailed ratios for one ticker.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol: raw } = await ctx.params;
  const symbol = (raw ?? "").trim().toUpperCase();
  if (!symbol || !/^[A-Z0-9]{3,12}$/.test(symbol)) {
    return badRequest("Mã cổ phiếu không hợp lệ");
  }

  try {
    const { getStockMetricsBundle } = await import("@/lib/services/stock-metrics-service");
    const r = await getStockMetricsBundle(symbol);
    if (!r) {
      return unavailable(
        "stock-metrics",
        `Không lấy được dữ liệu ${symbol} từ các nguồn (quote + BCTC)`,
      );
    }
    return ok(
      {
        symbol: r.bundle.symbol,
        quote: r.bundle.quote,
        price: r.bundle.price,
        changePercent: r.bundle.changePercent,
        sharesOutstanding: r.bundle.sharesOutstanding,
        marketCap: r.bundle.marketCap,
        period: r.bundle.period,
        qualityScore: r.bundle.qualityScore,
        ratios: r.bundle.ratios,
        ratioMap: r.bundle.ratioMap,
        sources: r.bundle.sources,
        notes: r.bundle.notes,
      },
      r.meta,
    );
  } catch (e) {
    console.error("[stocks/:symbol/metrics]", e);
    return unavailable("stock-metrics", e instanceof Error ? e.message : "metrics failed");
  }
}
