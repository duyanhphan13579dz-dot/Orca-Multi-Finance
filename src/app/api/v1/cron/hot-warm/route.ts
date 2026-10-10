import { ok, unavailable } from "@/lib/envelope";
import { cronUnauthorized } from "@/lib/cron-auth";
import { putHot, hotStats } from "@/lib/hot-snapshot";
import { runGuarded, guardMeta } from "@/lib/data-engine/workers-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 28;

/**
 * P0/P2-D unified hot-warm — board/intel/forex/global/multi-asset + fundamental/valuation screeners.
 * GET /api/v1/cron/hot-warm?secret=...
 * Recommended cadence: every 45–60s (24/7).
 */
export async function GET(req: Request) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;

  const t0 = Date.now();
  const HARD_MS = 26_000; // P2-D: room for screener warm
  const remaining = () => Math.max(0, HARD_MS - (Date.now() - t0));
  const results: Record<string, { ok: boolean; ms: number; note?: string }> = {};

  if (remaining() > 2_000) {
    const s = Date.now();
    try {
      const market = await runGuarded(
        async () => {
          const { getVnMarketBoard } = await import("@/lib/services/stocks");
          return getVnMarketBoard().catch(() => null);
        },
        { label: "hot-warm-board", wallMs: Math.min(10_000, remaining()), maxSubrequests: 16, maxConcurrent: 2 },
      );
      if (market && (market.quotes?.length || market.indices?.length)) {
        putHot(
          "board",
          {
            indices: market.indices,
            quotes: market.quotes,
            universeSize: market.universeSize ?? market.quotes.length,
            sessionDate: market.sessionDate ?? null,
            count: market.quotes.length,
          },
          {
            source: market.meta?.source ?? "board-warm",
            partial: market.meta?.partial,
            note: market.meta?.note,
          },
        );
        results.board = { ok: true, ms: Date.now() - s, note: `${market.quotes?.length ?? 0}q` };
      } else {
        results.board = { ok: false, ms: Date.now() - s, note: "empty" };
      }
    } catch (e) {
      results.board = { ok: false, ms: Date.now() - s, note: e instanceof Error ? e.message : "err" };
    }
  }

  if (remaining() > 3_000) {
    const s = Date.now();
    try {
      const pack = await runGuarded(
        async () => {
          const { buildMarketIntel } = await import("@/lib/services/market-intel");
          return buildMarketIntel().catch(() => null);
        },
        { label: "hot-warm-intel", wallMs: Math.min(12_000, remaining()), maxSubrequests: 18, maxConcurrent: 2 },
      );
      if (pack?.intel) {
        putHot("intel", pack.intel, {
          source: pack.meta?.source ?? "intel-warm",
          partial: pack.meta?.partial,
          note: pack.meta?.note,
        });
        results.intel = { ok: true, ms: Date.now() - s };
      } else {
        results.intel = { ok: false, ms: Date.now() - s, note: "empty" };
      }
    } catch (e) {
      results.intel = { ok: false, ms: Date.now() - s, note: e instanceof Error ? e.message : "err" };
    }
  }

  if (remaining() > 2_500) {
    const s = Date.now();
    try {
      const pack = await runGuarded(
        async () => {
          const { getForexMarkets } = await import("@/lib/services/forex");
          return getForexMarkets().catch(() => null);
        },
        { label: "hot-warm-forex", wallMs: Math.min(10_000, remaining()), maxSubrequests: 14, maxConcurrent: 2 },
      );
      if (pack?.data?.rows?.length) {
        putHot("forex", pack.data, {
          source: pack.meta?.source ?? "forex-warm",
          partial: pack.meta?.partial,
          note: pack.meta?.note,
        });
        results.forex = { ok: true, ms: Date.now() - s, note: `${pack.data.rows.length} pairs` };
      } else {
        results.forex = { ok: false, ms: Date.now() - s, note: "empty" };
      }
    } catch (e) {
      results.forex = { ok: false, ms: Date.now() - s, note: e instanceof Error ? e.message : "err" };
    }
  }

  if (remaining() > 2_000) {
    const s = Date.now();
    try {
      const pack = await runGuarded(
        async () => {
          const { getYahooQuotes } = await import("@/lib/providers/yahoo");
          const us = await getYahooQuotes(["SPY", "QQQ", "DIA"]);
          const usRows = [...us.entries()]
            .filter(([, q]) => q.price > 0)
            .map(([symbol, q]) => ({
              symbol,
              price: q.price,
              changePercent: q.changePercent ?? null,
            }));
          let crypto: { symbol: string; baseAsset: string; price: number; changePercent: number | null }[] = [];
          try {
            const { getCryptoMarkets } = await import("@/lib/services/crypto");
            const m = await getCryptoMarkets();
            crypto = (m?.rows ?? [])
              .filter((r) => r.symbol === "BTCUSDT" || r.symbol === "ETHUSDT")
              .map((r) => ({
                symbol: r.symbol,
                baseAsset: r.baseAsset,
                price: r.price,
                changePercent: r.changePercent,
              }));
          } catch {
            /* */
          }
          return {
            us: usRows,
            crypto,
            asia: [] as { symbol: string; label: string; price: number; changePercent: number | null }[],
            liquiditySpark: null,
            sources: ["hot-warm"],
            at: new Date().toISOString(),
          };
        },
        { label: "hot-warm-global", wallMs: Math.min(8_000, remaining()), maxSubrequests: 12, maxConcurrent: 2 },
      );
      if (pack && (pack.us.length || pack.crypto.length)) {
        putHot("global", pack, { source: "global-warm", partial: true });
        results.global = { ok: true, ms: Date.now() - s, note: `us=${pack.us.length} c=${pack.crypto.length}` };
      } else {
        results.global = { ok: false, ms: Date.now() - s, note: "empty" };
      }
    } catch (e) {
      results.global = { ok: false, ms: Date.now() - s, note: e instanceof Error ? e.message : "err" };
    }
  }

  if (remaining() > 2_000) {
    const s = Date.now();
    try {
      const pack = await runGuarded(
        async () => {
          try {
            const { getMultiAssetBoard } = await import("@/lib/services/multi-asset-board");
            return getMultiAssetBoard().catch(() => null);
          } catch {
            return null;
          }
        },
        { label: "hot-warm-multi", wallMs: Math.min(8_000, remaining()), maxSubrequests: 12, maxConcurrent: 2 },
      );
      if (pack?.board?.rows?.length) {
        const data = {
          rows: pack.board.rows,
          byClass: pack.board.byClass,
          sources: pack.board.sources,
          count: pack.board.rows.length,
        };
        putHot("multi-asset", data, {
          source: pack.meta?.source ?? "multi-warm",
          partial: pack.meta?.partial,
        });
        results["multi-asset"] = { ok: true, ms: Date.now() - s, note: `${pack.board.rows.length} rows` };
      } else {
        results["multi-asset"] = { ok: false, ms: Date.now() - s, note: "empty-or-missing" };
      }
    } catch (e) {
      results["multi-asset"] = { ok: false, ms: Date.now() - s, note: e instanceof Error ? e.message : "err" };
    }
  }

  // P2-D: warm default fundamental + valuation screeners (soft, budget-gated)
  if (remaining() > 4_000) {
    const s = Date.now();
    try {
      const pack = await runGuarded(
        async () => {
          const { screenFundamental } = await import("@/lib/services/fundamental-screener");
          return screenFundamental({ limit: 40 }).catch(() => null);
        },
        {
          label: "hot-warm-fundamental",
          wallMs: Math.min(8_000, remaining()),
          maxSubrequests: 14,
          maxConcurrent: 2,
        },
      );
      if (pack?.rows?.length) {
        putHot(
          "screener-fundamental",
          {
            rows: pack.rows,
            scanned: pack.scanned,
            skipped: pack.skipped,
            withData: pack.withData,
          },
          {
            source: pack.meta?.source ?? "fundamental-warm",
            partial: pack.meta?.partial,
            note: pack.meta?.note,
          },
        );
        results["screener-fundamental"] = {
          ok: true,
          ms: Date.now() - s,
          note: `${pack.rows.length} rows`,
        };
      } else {
        results["screener-fundamental"] = { ok: false, ms: Date.now() - s, note: "empty" };
      }
    } catch (e) {
      results["screener-fundamental"] = {
        ok: false,
        ms: Date.now() - s,
        note: e instanceof Error ? e.message : "err",
      };
    }
  }

  if (remaining() > 3_500) {
    const s = Date.now();
    try {
      const pack = await runGuarded(
        async () => {
          const { screenValuation } = await import("@/lib/services/valuation-screener");
          return screenValuation({ limit: 40 }).catch(() => null);
        },
        {
          label: "hot-warm-valuation",
          wallMs: Math.min(8_000, remaining()),
          maxSubrequests: 14,
          maxConcurrent: 2,
        },
      );
      if (pack?.rows?.length) {
        putHot(
          "screener-valuation",
          {
            rows: pack.rows,
            scanned: pack.scanned,
            skipped: pack.skipped,
            withData: pack.withData,
          },
          {
            source: pack.meta?.source ?? "valuation-warm",
            partial: pack.meta?.partial,
            note: pack.meta?.note,
          },
        );
        results["screener-valuation"] = {
          ok: true,
          ms: Date.now() - s,
          note: `${pack.rows.length} rows`,
        };
      } else {
        results["screener-valuation"] = { ok: false, ms: Date.now() - s, note: "empty" };
      }
    } catch (e) {
      results["screener-valuation"] = {
        ok: false,
        ms: Date.now() - s,
        note: e instanceof Error ? e.message : "err",
      };
    }
  }

  const okCount = Object.values(results).filter((r) => r.ok).length;
  if (!okCount) {
    return unavailable("hot-warm", "Không warm được slot nào — kiểm tra provider");
  }

  return ok(
    {
      ok: true,
      warmed: okCount,
      results,
      slots: hotStats(),
      durationMs: Date.now() - t0,
      guard: guardMeta(),
    },
    { source: "hot-warm", note: `${okCount} slots` },
    { "Cache-Control": "no-store" },
  );
}
