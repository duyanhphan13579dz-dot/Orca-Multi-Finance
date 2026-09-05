import { ok, fail } from "@/lib/envelope";
import { buildMarketIntel } from "@/lib/services/market-intel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** MARKET INTELLIGENCE — homepage command center payload (VN-first). */
export async function GET() {
  try {
    const { intel, meta } = await buildMarketIntel();
    return ok(intel, meta);
  } catch (e) {
    return fail("INTEL_FAILED", e instanceof Error ? e.message : "unknown", 502);
  }
}
