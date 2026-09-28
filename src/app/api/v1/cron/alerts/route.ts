import { ok } from "@/lib/envelope";
import { runServerAlertMonitor } from "@/lib/services/alert-engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Vercel Cron — price alerts + candlestick pattern scan + divergence scan.
 */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret) {
    const auth = req.headers.get("authorization") ?? "";
    const querySecret = new URL(req.url).searchParams.get("secret") ?? "";
    if (auth !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
      return new Response(
        JSON.stringify({ success: false, error: { code: "UNAUTHORIZED", message: "Invalid cron secret" } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  const t0 = Date.now();
  const result = await runServerAlertMonitor();
  let patterns: unknown = null;
  let divergences: unknown = null;
  try {
    const { runCandlestickPatternAlerts } = await import("@/lib/services/candlestick-screener");
    patterns = await runCandlestickPatternAlerts();
  } catch (e) {
    patterns = { error: e instanceof Error ? e.message : "pattern scan failed" };
  }
  try {
    const { runDivergenceAlerts } = await import("@/lib/services/divergence-screener");
    divergences = await runDivergenceAlerts();
  } catch (e) {
    divergences = { error: e instanceof Error ? e.message : "divergence scan failed" };
  }
  return ok({ ...result, patterns, divergences, durationMs: Date.now() - t0 });
}
