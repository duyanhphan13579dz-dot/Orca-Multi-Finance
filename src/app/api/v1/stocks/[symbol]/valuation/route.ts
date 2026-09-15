import { ok, badRequest, fail } from "@/lib/envelope";
import { runFundamentalValuation } from "@/lib/services/fundamental-valuation";
import { cached } from "@/lib/cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/stocks/:symbol/valuation
 *
 * Hệ thống định giá + phân tích cơ bản ĐỘC LẬP với trang Báo cáo tài chính.
 * Kéo BCTC trực tiếp từ VNDirect api-finfo → tính health + valuation.
 *
 * Query: ?peers=0 | ?full=1
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ symbol: string }> },
) {
  try {
    const { symbol: raw } = await ctx.params;
    const symbol = (raw ?? "").trim().toUpperCase();
    if (!symbol || !/^[A-Z0-9]{3,12}$/.test(symbol)) {
      return badRequest("symbol không hợp lệ (ví dụ FPT, VCB)");
    }

    const url = new URL(req.url);
    const wantPeers = url.searchParams.get("peers") !== "0";
    const wantFull = url.searchParams.get("full") === "1";
    const cacheKey = `val:direct:${symbol}:p${wantPeers ? 1 : 0}:f${wantFull ? 1 : 0}`;

    const cachedRes = await cached(cacheKey, {
      ttlMs: 60_000,
      staleMs: 240_000,
      producer: async () => {
        const r = await runFundamentalValuation(symbol, {
          peers: wantPeers,
          full: wantFull,
        });
        if (!r) {
          throw Object.assign(new Error(`Không lấy được dữ liệu định giá ${symbol}`), {
            code: "STOCK_UNAVAILABLE",
          });
        }
        return r;
      },
    });

    const r = cachedRes.value;
    return ok(r.data, {
      ...r.meta,
      cached: cachedRes.cached,
      stale: cachedRes.stale,
    });
  } catch (e) {
    if (e && typeof e === "object" && (e as { code?: string }).code === "STOCK_UNAVAILABLE") {
      return fail(
        "STOCK_UNAVAILABLE",
        e instanceof Error ? e.message : "Không lấy được dữ liệu",
        503,
      );
    }
    console.error("[valuation-direct]", e);
    return fail("VALUATION_ERROR", e instanceof Error ? e.message : "valuation failed", 500);
  }
}
