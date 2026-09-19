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
 * Schedule: post-ATC weekdays (see vercel.json).
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
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 60) || 60, 100);
  const custom = (url.searchParams.get("symbols") ?? "")
    .split(/[,\s;]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const universe = [
    ...new Set([...(custom.length ? custom : LIQUID_BOARD), ...DEFAULT_SYMBOLS.split(",")]),
  ].slice(0, limit);

  try {
    const r = await warmFundamentalSnapshots(universe, { concurrency: 4 });
    return ok({
      ok: true,
      scanned: r.scanned,
      warmed: r.warmed,
      durationMs: Date.now() - t0,
      note: "BCTC package + snapshot warm · persist financial_statements best-effort",
    });
  } catch (e) {
    return fail(
      "CRON_FINANCIALS_ERROR",
      e instanceof Error ? e.message : "Warm BCTC thất bại",
      500,
    );
  }
}
