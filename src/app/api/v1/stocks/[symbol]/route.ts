import { ok, unavailable } from "@/lib/envelope";
import { getVnStockDetail } from "@/lib/services/stocks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 25;

/**
 * GET /api/v1/stocks/:symbol
 * Single load (no double-retry) to stay under Workers CPU/subrequest budget.
 * Partial payload is OK when quote OR bars present.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const sym = (symbol ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return unavailable("vn-market", "Thiếu mã cổ phiếu");

  try {
    let r: Awaited<ReturnType<typeof getVnStockDetail>> = null;
    try {
      const { runInDataHub } = await import("@/lib/data-engine/hub");
      r = await runInDataHub(() => getVnStockDetail(sym));
    } catch {
      r = await getVnStockDetail(sym);
    }

    if (!r?.detail) {
      return unavailable("vn-market", `Chưa tải được ${sym}. Thử lại.`);
    }

    const hasPrice = Boolean(r.detail.quote?.price && r.detail.quote.price > 0);
    const hasBars = Boolean(r.detail.bars && r.detail.bars.length >= 5);
    const hasMeta = Boolean(r.detail.profile || r.detail.equity);

    if (hasPrice && r.detail.bars && r.detail.bars.length >= 20) {
      return ok(r.detail, r.meta);
    }
    if (hasPrice || hasBars || hasMeta) {
      return ok(r.detail, {
        ...r.meta,
        partial: true,
        note: r.meta?.note ?? `Partial ${sym}: đang đồng bộ dữ liệu.`,
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
