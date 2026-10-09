import { safeApi } from "@/lib/safe-api";
import { getMultiAssetBoard, getMultiAssetQuote } from "@/lib/services/multi-asset-board";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

/**
 * GET /api/v1/market/multi-asset
 *   ?symbol=BTC|ETH|XAU|XAG|EURUSD  → single quote
 * Default: full board BTC · ETH · XAU · XAG · major FOREX
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").trim();

  if (symbol) {
    return safeApi({
      label: `multi-asset:${symbol}`,
      guard: { wallMs: 12_000, maxSubrequests: 16, maxConcurrent: 2 },
      produce: async () => {
        const r = await getMultiAssetQuote(symbol);
        if (!r) return null;
        return { data: { row: r.row }, meta: r.meta };
      },
      fallback: async () => ({
        data: { row: null },
        meta: {
          source: "multi-asset-shell",
          partial: true,
          stale: true,
          note: `${symbol} tạm thiếu`,
        },
      }),
      unavailableSource: "multi-asset",
      unavailableNote: `Không có giá ${symbol}`,
    });
  }

  return safeApi({
    label: "multi-asset-board",
    guard: { wallMs: 14_000, maxSubrequests: 22, maxConcurrent: 3 },
    produce: async () => {
      const r = await getMultiAssetBoard();
      if (!r?.board.rows.length) return null;
      return {
        data: {
          rows: r.board.rows,
          byClass: r.board.byClass,
          sources: r.board.sources,
          count: r.board.rows.length,
        },
        meta: r.meta,
        headers: {
          "Cache-Control": r.meta.stale
            ? "private, max-age=8, stale-while-revalidate=60"
            : "private, max-age=12, stale-while-revalidate=45",
        },
      };
    },
    fallback: async () => ({
      data: {
        rows: [],
        byClass: { crypto: [], metal: [], forex: [] },
        sources: [],
        count: 0,
      },
      meta: {
        source: "multi-asset-shell",
        partial: true,
        stale: true,
        note: "Board đa tài sản tạm trống — đang kết nối lại",
      },
    }),
    unavailableSource: "multi-asset",
    unavailableNote: "Không tải được board BTC/ETH/XAU/XAG/FOREX",
  });
}
