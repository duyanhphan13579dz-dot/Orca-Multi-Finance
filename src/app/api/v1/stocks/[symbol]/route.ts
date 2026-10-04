import { ok, unavailable } from "@/lib/envelope";
import { getVnStockDetail } from "@/lib/services/stocks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/v1/stocks/:symbol — overview pack (quote · ohlcv · tech · profile · fin).
 * Soft-SWR cached in service; retries once on hard failure; prefers partial data over 503.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const sym = (symbol ?? "").toUpperCase();

  async function load() {
    const { runInDataHub } = await import("@/lib/data-engine/hub");
    return runInDataHub(() => getVnStockDetail(sym));
  }

  try {
    let r = await load();
    if (!r?.detail) {
      await new Promise((res) => setTimeout(res, 400));
      r = await load();
    }
    if (!r?.detail) {
      return unavailable(
        "vn-market",
        `Không lấy được dữ liệu ${sym} — các nguồn SSI/VNDirect/public đang thử lại.`,
      );
    }
    return ok(r.detail, r.meta);
  } catch (e) {
    console.error("[stocks/detail]", sym, e);
    try {
      const direct = await getVnStockDetail(sym);
      if (direct?.detail) return ok(direct.detail, direct.meta);
    } catch {
      /* */
    }
    return unavailable(
      "vn-market",
      e instanceof Error ? e.message : `Lỗi tải ${sym}`,
    );
  }
}
