import { ok, fail } from "@/lib/envelope";
import { warmFundamentalSnapshots } from "@/lib/financial/snapshots";
import { LIQUID_BOARD } from "@/lib/providers/public-vn-feed";
import { DEFAULT_SYMBOLS } from "@/lib/services/valuation-screener";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Warm BCTC packages + fundamental snapshots for liquid VN universe.
 * Auth: Bearer CRON_SECRET or ?secret=
 * Schedule: post-ATC weekdays via cronjob.org (see docs/CRONJOB_ORG.md).
 */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret) {
    const auth = req.headers.get("authorization") ?? "";
    const querySecret = new URL(req.url).searchParams.get("secret") ?? "";
    if (auth !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
      return fail("UNAUTHORIZED", "Invalid cron secret", 401);
    }
  }

  const t0 = Date.now();
  const symbols = [...new Set([...LIQUID_BOARD.slice(0, 80), ...DEFAULT_SYMBOLS])].slice(0, 100);
  try {
    const result = await warmFundamentalSnapshots(symbols);
    return ok({ ...result, symbolCount: symbols.length, durationMs: Date.now() - t0 });
  } catch (e) {
    return fail("FINANCIALS_WARM_FAILED", e instanceof Error ? e.message : "warm failed", 502);
  }
}
