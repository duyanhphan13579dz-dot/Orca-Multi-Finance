import { ok, fail } from "@/lib/envelope";
import { buildMarketBulletin } from "@/lib/services/market-bulletin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * INTRADAY MARKET BULLETIN — 11h30 mid-session market update for Vietnam stock market.
 * Provides VN-Index overview, money flow, sector highlights, and technical insights.
 */
export async function GET() {
  try {
    const { bulletin, meta } = await buildMarketBulletin();
    return ok(bulletin, meta);
  } catch (e) {
    return fail("BULLETIN_FAILED", e instanceof Error ? e.message : "unknown", 502);
  }
}
