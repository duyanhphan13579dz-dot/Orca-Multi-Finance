import { ok, badRequest, fail } from "@/lib/envelope";
import { runFundamentalValuation } from "@/lib/services/fundamental-valuation";
import { cached } from "@/lib/cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/stocks/:symbol/fundamentals
 *
 * Phân tích cơ bản độc lập — BCTC kéo thẳng VNDirect, không qua trang báo cáo.
 * Trả health score + anchors + groups (không bắt buộc full valuation detail).
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ symbol: string }> },
) {
  try {
    const { symbol: raw } = await ctx.params;
    const symbol = (raw ?? "").trim().toUpperCase();
    if (!symbol || !/^[A-Z0-9]{3,12}$/.test(symbol)) {
      return badRequest("symbol không hợp lệ");
    }

    const cachedRes = await cached(`fund:direct:${symbol}`, {
      ttlMs: 60_000,
      staleMs: 240_000,
      producer: async () => {
        const r = await runFundamentalValuation(symbol, { peers: false, full: false });
        if (!r) {
          throw Object.assign(new Error(`Không lấy được BCTC ${symbol}`), {
            code: "STOCK_UNAVAILABLE",
          });
        }
        return r;
      },
    });

    const r = cachedRes.value;
    const health = r.health;
    const snap = r.data.marketSnapshot as Record<string, unknown> | undefined;

    return ok(
      {
        symbol,
        pipeline: "fundamental-direct",
        market: snap ?? {
          price: r.data.currentPrice,
          sharesOutstanding: r.data.sharesOutstanding,
          marketCap: r.data.marketCap,
        },
        health: {
          score: health.score,
          grade: health.grade,
          anchors: health.anchors,
          groups: health.groups,
          warnings: health.warnings?.slice(0, 12),
          riskFlags: health.riskFlags?.slice(0, 8),
        },
        multiples: r.data.multiples,
        notes: r.data.notes,
      },
      {
        ...r.meta,
        cached: cachedRes.cached,
        stale: cachedRes.stale,
      },
    );
  } catch (e) {
    if (e && typeof e === "object" && (e as { code?: string }).code === "STOCK_UNAVAILABLE") {
      return fail(
        "STOCK_UNAVAILABLE",
        e instanceof Error ? e.message : "Không lấy được dữ liệu",
        503,
      );
    }
    console.error("[fundamentals-direct]", e);
    return fail("FUNDAMENTALS_ERROR", e instanceof Error ? e.message : "failed", 500);
  }
}
