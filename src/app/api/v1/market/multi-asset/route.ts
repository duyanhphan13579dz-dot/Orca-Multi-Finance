import { safeApi } from "@/lib/safe-api";
import { getMultiAssetBoard, getMultiAssetQuote } from "@/lib/services/multi-asset-board";
import { putHot, getHot } from "@/lib/hot-snapshot";
import { WORKERS_BUDGET } from "@/lib/data-engine/workers-budget";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** P8c: user path ≤15s */
export const maxDuration = 15;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").trim();

  if (symbol) {
    return safeApi({
      label: `multi-asset:${symbol}`,
      guard: {
        wallMs: WORKERS_BUDGET.apiWallMs,
        maxSubrequests: 12,
        maxConcurrent: 2,
      },
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
    guard: {
      wallMs: WORKERS_BUDGET.apiWallMs,
      maxSubrequests: WORKERS_BUDGET.maxSubrequestsPerRequest,
      maxConcurrent: WORKERS_BUDGET.maxParallelProviders,
    },
    produce: async () => {
      const fresh = await getHot("multi-asset");
      if (fresh?.fresh && fresh.data) {
        return {
          data: fresh.data,
          meta: { ...fresh.meta, note: `hot-fresh multi · ${Math.round(fresh.ageMs / 1000)}s` },
          headers: {
            "Cache-Control": "private, max-age=8, stale-while-revalidate=40",
            "X-Orca-Hot": "fresh",
            "X-Orca-Mode": "hot",
          },
        };
      }
      const r = await getMultiAssetBoard();
      if (!r?.board.rows.length) return null;
      const data = {
        rows: r.board.rows,
        byClass: r.board.byClass,
        sources: r.board.sources,
        count: r.board.rows.length,
      };
      putHot("multi-asset", data, { source: r.meta?.source, partial: r.meta?.partial });
      return {
        data,
        meta: r.meta,
        headers: {
          "Cache-Control": r.meta.stale
            ? "private, max-age=8, stale-while-revalidate=60"
            : "private, max-age=12, stale-while-revalidate=45",
          "X-Orca-Mode": "live",
        },
      };
    },
    fallback: async () => {
      const snap = await getHot("multi-asset");
      if (snap?.data) {
        return {
          data: snap.data,
          meta: {
            ...snap.meta,
            note: `last-good multi · age ${Math.round(snap.ageMs / 1000)}s`,
            partial: true,
            stale: true,
          },
        };
      }
      return {
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
      };
    },
    unavailableSource: "multi-asset",
    unavailableNote: "Không tải được board BTC/ETH/XAU/XAG/FOREX",
  });
}
