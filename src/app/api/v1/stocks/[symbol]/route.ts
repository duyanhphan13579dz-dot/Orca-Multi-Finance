import { ok, unavailable } from "@/lib/envelope";
import { getVnStockDetail } from "@/lib/services/stocks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/v1/stocks/:symbol
 * Prefer full core (quote + ≥20 bars). When partial, still return payload with meta.partial
 * so the detail layout can render hero/quote while charts recover.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const sym = (symbol ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return unavailable("vn-market", "Thiếu mã cổ phiếu");

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

  const isUsable = (r: Awaited<ReturnType<typeof getVnStockDetail>>) =>
    Boolean(
      (r?.detail?.quote?.price && r.detail.quote.price > 0) ||
        (r?.detail?.bars && r.detail.bars.length >= 5) ||
        r?.detail?.profile ||
        r?.detail?.equity,
    );

  try {
    let r = await load();
    if (!isFull(r)) {
      // Single soft retry for transient provider blips
      r = await load();
    }
    if (isFull(r) && r?.detail) {
      return ok(r.detail, r.meta);
    }
    if (isUsable(r) && r?.detail) {
      return ok(r.detail, {
        ...r.meta,
        partial: true,
        note:
          r.meta?.note ??
          `Partial ${sym}: đang đồng bộ giá/nến — hiển thị phần đã có.`,
      });
    }
    return unavailable(
      "vn-market",
      `Chưa tải đủ dữ liệu ${sym} (cần giá hoặc lịch sử nến). Thử lại.`,
    );
  } catch (e) {
    console.error("[stocks/detail]", sym, e);
    return unavailable(
      "vn-market",
      e instanceof Error ? e.message : `Lỗi tải ${sym}`,
    );
  }
}
