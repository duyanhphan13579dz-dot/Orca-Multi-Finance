import { ok, unavailable } from "@/lib/envelope";
import { getVnStockDetail } from "@/lib/services/stocks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/v1/stocks/:symbol — overview pack.
 * First load may be slow (cold providers) — retry with backoff; prefer partial 200 over 503.
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

  const hasCore = (r: Awaited<ReturnType<typeof getVnStockDetail>>) =>
    Boolean(r?.detail?.quote?.price || (r?.detail?.bars && r.detail.bars.length >= 5));

  try {
    let r = await load();
    for (let attempt = 0; attempt < 3 && !hasCore(r); attempt++) {
      await new Promise((res) => setTimeout(res, 700 + attempt * 500));
      r = await load();
    }
    if (r?.detail) {
      return ok(r.detail, r.meta);
    }
    return unavailable(
      "vn-market",
      `Không lấy được dữ liệu ${sym} — đang thử lại các nguồn SSI/VNDirect/public.`,
    );
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
