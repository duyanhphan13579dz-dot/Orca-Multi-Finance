import { ok, unavailable } from "@/lib/envelope";
import { getCryptoMarkets } from "@/lib/services/crypto";
import { cronUnauthorized } from "@/lib/cron-auth";
import { runGuarded, guardMeta } from "@/lib/data-engine/workers-guard";
import { putHot } from "@/lib/hot-snapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * Light crypto market pre-warm — keeps last-good + cache hot.
 * GET /api/v1/cron/crypto-warm?secret=...
 * Recommend every 60–90s (crypto is 24/7).
 */
export async function GET(req: Request) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;

  const t0 = Date.now();
  try {
    const market = await runGuarded(
      async () => getCryptoMarkets().catch(() => null),
      {
        label: "cron-crypto-warm",
        wallMs: 12_000,
        maxSubrequests: 18,
        maxConcurrent: 2,
      },
    );

    if (!market?.rows?.length) {
      return unavailable("crypto-warm", "Crypto market warm failed — last-good may still serve UI");
    }

    putHot(
      "crypto",
      { rows: market.rows.slice(0, 80), summary: market.summary },
      market.meta,
    );

    return ok(
      {
        ok: true,
        count: market.rows.length,
        source: market.meta.source,
        btc: market.summary.btcChangePercent,
        eth: market.summary.ethChangePercent,
        totalQuoteVolume: market.summary.totalQuoteVolume,
        durationMs: Date.now() - t0,
        guard: guardMeta(),
      },
      market.meta,
      { "Cache-Control": "no-store" },
    );
  } catch (e) {
    return unavailable(
      "crypto-warm",
      e instanceof Error ? e.message : "crypto warm error",
    );
  }
}
