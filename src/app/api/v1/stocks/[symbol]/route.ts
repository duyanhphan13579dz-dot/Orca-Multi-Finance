import { ok, unavailable } from "@/lib/envelope";
import { getVnStockDetail } from "@/lib/services/stocks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Client budget is 15s — finish or fail within that window */
export const maxDuration = 20;

/**
 * GET /api/v1/stocks/:symbol
 * Require FULL core pack (quote + bars) within ~15s. No partial success.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const sym = (symbol ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return unavailable("vn-market", "Thiếu mã cổ phiếu");

  const deadline = Date.now() + 14_500;

  async function load() {
    try {
      const { runInDataHub } = await import("@/lib/data-engine/hub");
      return await runInDataHub(() => getVnStockDetail(sym));
    } catch {
      return await getVnStockDetail(sym);
    }
  }

  const isFull = (r: Awaited<ReturnType<typeof getVnStockDetail>>) =>
    Boolean(
      r?.detail?.quote?.price &&
        r.detail.quote.price > 0 &&
        r.detail.bars &&
        r.detail.bars.length >= 20,
    );

  try {
    let r = await load();
    if (!isFull(r) && Date.now() < deadline - 3_000) {
      await new Promise((res) => setTimeout(res, 400));
      r = await load();
    }
    if (isFull(r) && r?.detail) {
      return ok(r.detail, r.meta);
    }
    return unavailable(
      "vn-market",
      `Chưa tải đủ dữ liệu ${sym} trong 15s (cần giá + lịch sử nến). Thử lại.`,
    );
  } catch (e) {
    console.error("[stocks/detail]", sym, e);
    return unavailable(
      "vn-market",
      e instanceof Error ? e.message : `Lỗi tải ${sym}`,
    );
  }
}
