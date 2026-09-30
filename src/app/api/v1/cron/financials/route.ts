import { ok, fail } from "@/lib/envelope";
import { warmFundamentalSnapshots } from "@/lib/financial/snapshots";
import { LIQUID_BOARD } from "@/lib/providers/public-vn-feed";
import { DEFAULT_SYMBOLS } from "@/lib/services/valuation-screener";
import { resolveListedEquityUniverse, listedEquityUniverseSync } from "@/lib/financial/equity-universe";
import { warmCanslimDefault, CANSLIM_DEFAULT_CAP } from "@/lib/services/canslim-screener";
import { batchVnOhlcv } from "@/lib/services/ohlcv-batch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** cronjob.org free/plan timeout is often 30s — finish before that. */
export const maxDuration = 30;

const BUDGET_MS = 25_000;

type Phase = "bctc" | "ohlcv" | "canslim" | "auto";

function parsePhase(raw: string | null): Phase {
  const p = (raw ?? "auto").toLowerCase();
  if (p === "bctc" || p === "ohlcv" || p === "canslim") return p;
  return "auto";
}

/**
 * Warm BCTC / OHLCV / CANSLIM cache in 30s-safe phases (cronjob.org).
 *
 * Recommended (Asia/Ho_Chi_Minh), timeout 30s each:
 *   16:05  .../financials?phase=bctc&offset=0&limit=25
 *   16:07  .../financials?phase=bctc&offset=25&limit=25
 *   16:09  .../financials?phase=bctc&offset=50&limit=25
 *   … lặp offset += 25 tới hết universe (~400–600 mã)
 *   16:16  .../financials?phase=ohlcv
 *   16:18  .../financials?phase=canslim
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
  const phase = parsePhase(url.searchParams.get("phase"));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20) || 20, 1), 30);
  const custom = (url.searchParams.get("symbols") ?? "")
    .split(/[,\s;]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  let board = custom.length
    ? custom
    : [...new Set([...LIQUID_BOARD, ...DEFAULT_SYMBOLS.split(","), ...listedEquityUniverseSync(500)])];
  if (!custom.length) {
    try {
      const uni = await resolveListedEquityUniverse({ max: 600 });
      if (uni.symbols.length) board = uni.symbols;
    } catch {
      /* keep merged board */
    }
  }
  const fullUniverse = [...new Set(board.map((s) => s.toUpperCase()))];

  try {
    const out: Record<string, unknown> = { ok: true, phase, durationMs: 0 };

    if (phase === "bctc" || phase === "auto") {
      const slice = fullUniverse.slice(offset, offset + limit);
      if (!slice.length) {
        return ok({
          ok: true,
          phase,
          scanned: 0,
          warmed: 0,
          durationMs: Date.now() - t0,
          note: "empty BCTC slice",
        });
      }
      const r = await warmFundamentalSnapshots(slice, { concurrency: 8 });
      out.scanned = r.scanned;
      out.warmed = r.warmed;
      out.offset = offset;
      out.limit = limit;
      out.sliceSize = slice.length;
      out.universeSize = fullUniverse.length;
      out.note = `BCTC slice offset=${offset} limit=${limit} / universe ${fullUniverse.length} · 30s-safe`;
    }

    if (phase === "ohlcv") {
      const ohlcvBoard = fullUniverse.slice(0, CANSLIM_DEFAULT_CAP);
      const map = await batchVnOhlcv(ohlcvBoard, { bars: 140, concurrency: 10 });
      out.ohlcvWarmed = map.size;
      out.board = ohlcvBoard.length;
      out.note = "OHLCV pre-warm CANSLIM board";
    }

    if (phase === "canslim") {
      const remaining = BUDGET_MS - (Date.now() - t0);
      if (remaining < 8_000) {
        out.canslim = null;
        out.note = "skip canslim — budget low";
      } else {
        const canslim = await warmCanslimDefault().catch(() => null);
        out.canslim = canslim;
        out.note = "CANSLIM result cache seed";
      }
    }

    out.durationMs = Date.now() - t0;
    return ok(out);
  } catch (e) {
    return fail(
      "CRON_FINANCIALS_ERROR",
      e instanceof Error ? e.message : "Warm BCTC thất bại",
      500,
    );
  }
}
