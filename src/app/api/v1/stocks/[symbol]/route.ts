import { unavailable } from "@/lib/envelope";
import { getVnStockDetail } from "@/lib/services/stocks";
import { safeApi } from "@/lib/safe-api";
import { WORKERS_BUDGET } from "@/lib/data-engine/workers-budget";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

/**
 * GET /api/v1/stocks/:symbol
 * Anti-break: guarded budget + partial shell always preferred over 502/1102.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const sym = (symbol ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return unavailable("vn-market", "Thiếu mã cổ phiếu");

  return safeApi({
    label: `vn-detail:${sym}`,
    guard: {
      wallMs: WORKERS_BUDGET.detailWallMs,
      maxSubrequests: 20,
      maxConcurrent: 3,
    },
    produce: async () => {
      let r: Awaited<ReturnType<typeof getVnStockDetail>> = null;
      try {
        const { runInDataHub } = await import("@/lib/data-engine/hub");
        r = await runInDataHub(() => getVnStockDetail(sym));
      } catch {
        r = await getVnStockDetail(sym);
      }
      if (!r?.detail) return null;

      const hasPrice = Boolean(r.detail.quote?.price && r.detail.quote.price > 0);
      const hasBars = Boolean(r.detail.bars && r.detail.bars.length >= 5);
      const hasMeta = Boolean(r.detail.profile || r.detail.equity);

      if (!hasPrice && !hasBars && !hasMeta) return null;

      return {
        data: r.detail,
        meta: {
          ...r.meta,
          partial: !(hasPrice && hasBars && r.detail.bars && r.detail.bars.length >= 20),
          note:
            hasPrice && hasBars && r.detail.bars.length >= 20
              ? r.meta?.note
              : r.meta?.note ?? `Partial ${sym}: đang đồng bộ dữ liệu.`,
        },
      };
    },
    fallback: async () => ({
      data: {
        symbol: sym,
        name: null,
        quote: null,
        bars: [],
        technical: null,
        patterns: [],
        equity: null,
        sharesOutstanding: null,
        profile: null,
        orderBook: null,
        foreignFlow: null,
        financials: null,
        financialHealth: null,
        financialMeta: null,
        financialGrowth: null,
        financialTtm: null,
        detailedRatios: null,
        ratioMap: {},
        metricsSources: [],
        notes: ["degraded-shell"],
      },
      meta: {
        source: "degraded-shell",
        partial: true,
        stale: true,
        note: `Shell ${sym} — nguồn đang phục hồi`,
      },
    }),
    unavailableSource: "vn-market",
    unavailableNote: `Chưa tải được ${sym}. Thử lại.`,
  });
}
