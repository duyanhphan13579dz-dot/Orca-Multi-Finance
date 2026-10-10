import { ok, unavailable } from "@/lib/envelope";
import { cronUnauthorized } from "@/lib/cron-auth";
import { runGuarded, guardMeta } from "@/lib/data-engine/workers-guard";
import { WORKERS_BUDGET } from "@/lib/data-engine/workers-budget";
import { putHot } from "@/lib/hot-snapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * P8a: focused global market warm (US ETF + BTC/ETH).
 * GET /api/v1/cron/global-warm?secret=...
 * Recommend every 60s.
 */
export async function GET(req: Request) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;

  const t0 = Date.now();
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

        let crypto: {
          symbol: string;
          baseAsset: string;
          price: number;
          changePercent: number | null;
        }[] = [];
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
          sources: ["global-warm"],
          at: new Date().toISOString(),
        };
      },
      {
        label: "cron-global-warm",
        wallMs: Math.min(12_000, WORKERS_BUDGET.cronDomainWallMs),
        maxSubrequests: 14,
        maxConcurrent: 2,
      },
    );

    if (!pack || (!pack.us.length && !pack.crypto.length)) {
      return unavailable("global-warm", "Global warm empty — last-good may still serve UI");
    }

    putHot("global", pack, { source: "global-warm", partial: true });

    return ok(
      {
        ok: true,
        us: pack.us.length,
        crypto: pack.crypto.length,
        durationMs: Date.now() - t0,
        guard: guardMeta(),
      },
      { source: "global-warm", partial: true },
      { "Cache-Control": "no-store" },
    );
  } catch (e) {
    return unavailable("global-warm", e instanceof Error ? e.message : "global warm error");
  }
}
