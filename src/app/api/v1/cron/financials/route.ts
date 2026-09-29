import { ok, fail } from "@/lib/envelope";
import { warmFundamentalSnapshots } from "@/lib/financial/snapshots";
import { LIQUID_BOARD } from "@/lib/providers/public-vn-feed";
import { DEFAULT_SYMBOLS } from "@/lib/services/valuation-screener";
import { warmCanslimDefault, CANSLIM_DEFAULT_CAP } from "@/lib/services/canslim-screener";
import { batchVnOhlcv } from "@/lib/services/ohlcv-batch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** BCTC warm + optional CANSLIM seed — needs headroom. */
export const maxDuration = 90;

/**
 * Warm BCTC packages + fundamental snapshots for liquid VN universe,
 * then seed CANSLIM result cache (default board) so UI is instant.
 *
 * Auth: Bearer CRON_SECRET or ?secret=
 * Schedule (cronjob.org, Asia/Ho_Chi_Minh):
 *   - Financials: weekdays 16:15 (timeout ≥ 90s)
 *   - Financials late: weekdays 17:30 backup
 *
 * Query:
 *   ?limit=80          universe size (default 80, max 100)
 *   ?symbols=FPT,HPG   optional override
 *   ?canslim=0         skip CANSLIM seed (default 1)
 *   ?ohlcv=0           skip OHLCV pre-warm for CANSLIM board (default 1)
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
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 80) || 80, 100);
  const doCanslim = url.searchParams.get("canslim") !== "0";
  const doOhlcv = url.searchParams.get("ohlcv") !== "0";
  const custom = (url.searchParams.get("symbols") ?? "")
    .split(/[,\s;]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const universe = [
    ...new Set([...(custom.length ? custom : LIQUID_BOARD), ...DEFAULT_SYMBOLS.split(",")]),
  ].slice(0, limit);

  try {
    // 1) BCTC + snapshots → memory/Redis (12h snap TTL in snapshots.ts)
    const r = await warmFundamentalSnapshots(universe, { concurrency: 6 });

    // 2) Pre-warm OHLCV for CANSLIM default board (helps first UI hit)
    let ohlcvWarmed = 0;
    if (doOhlcv) {
      const board = universe.slice(0, CANSLIM_DEFAULT_CAP);
      const map = await batchVnOhlcv(board, { bars: 140, concurrency: 10 });
      ohlcvWarmed = map.size;
    }

    // 3) Seed CANSLIM result cache (default + common UI filters)
    let canslim: { rows: number; scanned: number; ms: number } | null = null;
    if (doCanslim) {
      canslim = await warmCanslimDefault().catch(() => null);
    }

    return ok({
      ok: true,
      scanned: r.scanned,
      warmed: r.warmed,
      ohlcvWarmed,
      canslim,
      durationMs: Date.now() - t0,
      note:
        "BCTC package + snapshot warm · OHLCV board · CANSLIM result cache seed · persist best-effort",
    });
  } catch (e) {
    return fail(
      "CRON_FINANCIALS_ERROR",
      e instanceof Error ? e.message : "Warm BCTC thất bại",
      500,
    );
  }
}
