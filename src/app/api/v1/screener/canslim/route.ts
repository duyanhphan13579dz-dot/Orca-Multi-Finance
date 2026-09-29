import { ok } from "@/lib/envelope";
import { screenCanslim } from "@/lib/services/canslim-screener";
import type { CanslimLetter } from "@/lib/engines/canslim";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** CANSLIM pulls OHLCV + BCTC + ratios — needs headroom beyond default 15s. */
export const maxDuration = 90;

const LETTERS = new Set<CanslimLetter>(["C", "A", "N", "S", "L", "I", "M"]);

/**
 * GET /api/v1/screener/canslim
 * Pipeline: quotes + OHLCV batch + BCTC bulk + VNDirect ratios/equity + foreign + VNINDEX M.
 * Never returns hard UNAVAILABLE — empty/partial table with meta instead.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const minScore = url.searchParams.get("minScore") != null ? Number(url.searchParams.get("minScore")) : 50;
  const minPass = url.searchParams.get("minPass") != null ? Number(url.searchParams.get("minPass")) : 0;
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

  let payload: Awaited<ReturnType<typeof screenCanslim>>;
  try {
    payload = await screenCanslim({
      symbols: symbols.length ? symbols : undefined,
      minScore: Number.isFinite(minScore) ? minScore : 50,
      minPass: Number.isFinite(minPass) ? minPass : 0,
      requireLetters: requireLetters.length ? requireLetters : undefined,
      sector,
      limit,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "pipeline error";
    payload = null;
    return ok(
      {
        universe: "canslim",
        rows: [],
        scanned: 0,
        skipped: 0,
        marketBullish: null,
        marketDetail: msg.slice(0, 120),
        coverage: { withBars: 0, withGrowth: 0, withHealth: 0, withForeign: 0, withRatios: 0, withEquity: 0 },
      },
      {
        source: "canslim-screener",
        sourceTimestampMs: Date.now(),
        hasData: false,
        partial: true,
        note: `CANSLIM lỗi tạm — ${msg.slice(0, 80)} — thử lại hoặc thu hẹp mã`,
      },
    );
  }

  const body = payload ?? {
    rows: [],
    scanned: 0,
    skipped: 0,
    marketBullish: null,
    marketDetail: "OHLCV/BCTC tạm lỗi",
    coverage: { withBars: 0, withGrowth: 0, withHealth: 0, withForeign: 0, withRatios: 0, withEquity: 0 },
    meta: {
      source: "canslim-screener",
      sourceTimestampMs: Date.now(),
      hasData: false,
      partial: true,
      note: "OHLCV/BCTC tạm lỗi — thử lại sau",
    },
  };

  return ok(
    {
      universe: "canslim",
      rows: body.rows,
      scanned: body.scanned,
      skipped: body.skipped,
      marketBullish: body.marketBullish,
      marketDetail: body.marketDetail,
      coverage: body.coverage,
    },
    body.meta,
  );
}
