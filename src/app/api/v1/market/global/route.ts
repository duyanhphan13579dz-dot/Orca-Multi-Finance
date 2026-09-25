import { ok, fail } from "@/lib/envelope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/market/global
 * US index ETFs (Polygon) + crypto tip (CoinGecko) — best-effort multi-provider pulse.
 */
export async function GET() {
  try {
    const sources: string[] = [];
    let us: unknown[] = [];
    let crypto: unknown[] = [];
    const errors: string[] = [];

    try {
      const { getPolygonIndexSnapshots } = await import("@/lib/providers/polygon");
      const poly = await getPolygonIndexSnapshots(["SPY", "QQQ", "DIA", "IWM"]);
      us = poly.rows;
      sources.push("polygon");
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "polygon failed");
    }

    try {
      const { getCoinGeckoSimplePrices } = await import("@/lib/providers/coingecko");
      const cg = await getCoinGeckoSimplePrices();
      crypto = cg.rows.slice(0, 10);
      sources.push(`coingecko:${cg.via}`);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "coingecko failed");
    }

    if (!us.length && !crypto.length) {
      return fail("GLOBAL_MARKET_UNAVAILABLE", errors.join("; ") || "no providers", 502);
    }

    return ok(
      { us, crypto, sources, at: new Date().toISOString() },
      {
        source: sources.join("+") || "none",
        sourceTimestampMs: Date.now(),
        partial: errors.length > 0,
        note: errors.length ? errors.join("; ") : undefined,
      },
    );
  } catch (e) {
    return fail("GLOBAL_MARKET_FAILED", e instanceof Error ? e.message : "unknown", 502);
  }
}
