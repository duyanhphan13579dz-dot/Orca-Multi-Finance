import { ok } from "@/lib/envelope";
import { runServerAlertMonitor } from "@/lib/services/alert-engine";
import { cronUnauthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * External cron (cronjob.org) — price alerts + candlestick + divergence + warm cache.
 */
export async function GET(req: Request) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;

  const t0 = Date.now();
  const result = await runServerAlertMonitor();
  let patterns: unknown = null;
  let divergences: unknown = null;
  let divergenceWarm: unknown = null;

  try {
    const { runCandlestickPatternAlerts } = await import("@/lib/services/candlestick-screener");
    patterns = await runCandlestickPatternAlerts();
  } catch (e) {
    patterns = { error: e instanceof Error ? e.message : "pattern scan failed" };
  }

  try {
    const { runDivergenceAlerts, warmVnDivergenceScreen } = await import(
      "@/lib/services/divergence-screener"
    );
    divergences = await runDivergenceAlerts();
    // Refill default UI cache so next user open is instant
    divergenceWarm = await warmVnDivergenceScreen();
  } catch (e) {
    divergences = { error: e instanceof Error ? e.message : "divergence scan failed" };
  }

  return ok({
    ...result,
    patterns,
    divergences,
    divergenceWarm,
    durationMs: Date.now() - t0,
  });
}
