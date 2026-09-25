import { ok } from "@/lib/envelope";
import { runServerAlertMonitor } from "@/lib/services/alert-engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Vercel Cron — server-side price alert monitor (no browser needed).
 * Requires Google Sheets Alerts tab + DISCORD_WEBHOOK_URL.
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
  return ok({ ...result, durationMs: Date.now() - t0 });
}
