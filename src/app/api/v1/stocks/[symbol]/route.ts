import { ok, unavailable } from "@/lib/envelope";
import { getVnStockDetail } from "@/lib/services/stocks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/v1/stocks/:symbol — overview pack (quote · ohlcv · tech · profile · fin).
 * Soft-SWR cached in service; Data Hub scope for singleflight with sibling panels.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  try {
    const { runInDataHub } = await import("@/lib/data-engine/hub");
    const r = await runInDataHub(() => getVnStockDetail(symbol));
    if (!r) {
      return unavailable(
        "vndirect",
        `Không lấy được dữ liệu ${symbol.toUpperCase()} từ VNDirect — xem /system để biết trạng thái provider.`,
      );
    }
    return ok(r.detail, r.meta);
  } catch (e) {
    console.error("[stocks/detail]", e);
    return unavailable(
      "vndirect",
      e instanceof Error ? e.message : `Lỗi tải ${symbol.toUpperCase()}`,
    );
  }
}
