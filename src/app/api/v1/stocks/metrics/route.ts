import { ok, badRequest, unavailable } from "@/lib/envelope";
import { LIQUID_BOARD } from "@/lib/providers/public-vn-feed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/v1/stocks/metrics?symbols=FPT,VCB,HPG
 *        &limit=40  (when no symbols — use liquid board slice)
 *
 * Multi-source quotes + BCTC + detailed financial ratios per ticker.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = (url.searchParams.get("symbols") ?? "").trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 30) || 30, 1), 80);
  const concurrency = Math.min(
    Math.max(Number(url.searchParams.get("concurrency") ?? 6) || 6, 1),
    12,
  );

  let symbols = raw
    .split(/[,\s;]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z0-9]{3,12}$/.test(s));

  if (!symbols.length) {
    symbols = [...LIQUID_BOARD].slice(0, limit);
  } else {
    symbols = symbols.slice(0, limit);
  }

  if (!symbols.length) {
    return badRequest("Cần symbols=FPT,VCB hoặc dùng liquid board");
  }

  try {
    const { getStockMetricsBulk } = await import("@/lib/services/stock-metrics-service");
    const r = await getStockMetricsBulk(symbols, { concurrency });
    if (!r.hit) {
      return unavailable(
        "stock-metrics",
        `Không lấy được metrics cho ${symbols.slice(0, 5).join(",")}… — kiểm tra VNDirect/public feeds`,
      );
    }
    return ok(
      {
        items: r.items.map((b) => ({
          symbol: b.symbol,
          price: b.price,
          changePercent: b.changePercent,
          marketCap: b.marketCap,
          sharesOutstanding: b.sharesOutstanding,
          period: b.period,
          qualityScore: b.qualityScore,
          ratioMap: b.ratioMap,
          ratios: b.ratios
            ? {
                period: b.ratios.period,
                marketCap: b.ratios.marketCap,
                enterpriseValue: b.ratios.enterpriseValue,
                quality: b.ratios.quality,
                categories: b.ratios.categories,
              }
            : null,
          sources: b.sources,
          notes: b.notes,
        })),
        scanned: r.scanned,
        hit: r.hit,
        sourcesUsed: r.sourcesUsed,
        quoteSources: r.quoteSources ?? [],
        conflicts: r.conflicts ?? 0,
      },
      {
        source: (r.quoteSources?.length ? r.quoteSources : r.sourcesUsed).join("+") || "stock-metrics",
        freshness: "FRESH",
        ageMs: 0,
      },
    );
  } catch (e) {
    console.error("[stocks/metrics]", e);
    return unavailable(
      "stock-metrics",
      e instanceof Error ? e.message : "metrics bulk failed",
    );
  }
}
