import { ok } from "@/lib/envelope";
import { screenCanslim } from "@/lib/services/canslim-screener";
import type { CanslimLetter } from "@/lib/engines/canslim";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Realtime path targets ~22s; full phase may use more when explicitly requested. */
export const maxDuration = 60;

const LETTERS = new Set<CanslimLetter>(["C", "A", "N", "S", "L", "I", "M"]);

/**
 * GET /api/v1/screener/canslim — realtime-first, always usable when OHLCV works.
 *
 * Default (phase=auto):
 *   Phase A: quotes + OHLCV → N/S/L/M (guaranteed)
 *   Phase B: BCTC/ROE/NN best-effort under ~10s budget (hub cache-first)
 *
 * Never hard-fails to UNAVAILABLE if any bars exist; strict filters fall back to top-by-score.
 *
 * Query: ?phase=tech|full|auto  ?symbols=  ?minScore=  ?minPass=  ?letters=  ?sector=
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const minScore =
    url.searchParams.get("minScore") != null ? Number(url.searchParams.get("minScore")) : 40;
  const minPass =
    url.searchParams.get("minPass") != null ? Number(url.searchParams.get("minPass")) : 0;
  const sector = url.searchParams.get("sector") || undefined;
  const symbols = (url.searchParams.get("symbols") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 40) || 40, 48);
  const requireLetters = (url.searchParams.get("letters") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is CanslimLetter => LETTERS.has(s as CanslimLetter));
  const phaseRaw = (url.searchParams.get("phase") ?? "auto").toLowerCase();
  const phase =
    phaseRaw === "tech" || phaseRaw === "full" ? (phaseRaw as "tech" | "full") : ("auto" as const);

  try {
    const payload = await screenCanslim({
      symbols: symbols.length ? symbols : undefined,
      minScore: Number.isFinite(minScore) ? minScore : 40,
      minPass: Number.isFinite(minPass) ? minPass : 0,
      requireLetters: requireLetters.length ? requireLetters : undefined,
      sector,
      limit,
      phase,
    });

    const body = payload ?? {
      rows: [] as NonNullable<typeof payload> extends infer R
        ? R extends { rows: infer Rows }
          ? Rows
          : never
        : never,
      scanned: 0,
      skipped: 0,
      marketBullish: null as boolean | null,
      marketDetail: "OHLCV tạm lỗi",
      coverage: {
        withBars: 0,
        withGrowth: 0,
        withHealth: 0,
        withForeign: 0,
        withRatios: 0,
        withEquity: 0,
      },
      phase: "tech" as const,
      meta: {
        source: "canslim-realtime",
        sourceTimestampMs: Date.now(),
        hasData: false,
        partial: true,
        note: "OHLCV tạm lỗi — thử lại hoặc chọn ít mã hơn",
      },
    };

    return ok(
      {
        universe: "canslim",
        phase: body.phase,
        rows: body.rows,
        scanned: body.scanned,
        skipped: body.skipped,
        marketBullish: body.marketBullish,
        marketDetail: body.marketDetail,
        coverage: body.coverage,
      },
      body.meta,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "pipeline error";
    return ok(
      {
        universe: "canslim",
        phase: "tech",
        rows: [],
        scanned: 0,
        skipped: 0,
        marketBullish: null,
        marketDetail: msg.slice(0, 120),
        coverage: {
          withBars: 0,
          withGrowth: 0,
          withHealth: 0,
          withForeign: 0,
          withRatios: 0,
          withEquity: 0,
        },
      },
      {
        source: "canslim-realtime",
        sourceTimestampMs: Date.now(),
        hasData: false,
        partial: true,
        note: `CANSLIM lỗi tạm — ${msg.slice(0, 80)} — thử lại`,
      },
    );
  }
}
