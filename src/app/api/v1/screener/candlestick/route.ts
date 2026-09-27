import { ok, unavailable, badRequest } from "@/lib/envelope";
import {
  getRecentPatternAlerts,
  screenCandlestickPatterns,
} from "@/lib/services/candlestick-screener";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/v1/screener/candlestick
 *   ?category=bullish_reversal|bearish_reversal|continuation|all
 *   &minScore=55&limit=40&volumeOnly=1&symbols=VCB,FPT
 *   &recent=1  → chỉ trả các cảnh báo đảo chiều đã fire (in-memory, sau cron)
 */
export async function GET(req: Request) {
  const url = new URL(req.url);

  if (url.searchParams.get("recent") === "1") {
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 20) || 20, 50);
    const events = getRecentPatternAlerts(limit);
    return ok({
      events,
      count: events.length,
      note: "Reversal pattern alerts fired by cron (deduped per day)",
    });
  }

  const category = (url.searchParams.get("category") ?? "all").toLowerCase();
  const allowed = new Set([
    "all",
    "bullish_reversal",
    "bearish_reversal",
    "continuation",
    "neutral",
  ]);
  if (!allowed.has(category)) {
    return badRequest("category không hợp lệ");
  }
  const minScore = Number(url.searchParams.get("minScore") ?? 55);
  const limit = Number(url.searchParams.get("limit") ?? 40);
  const volumeOnly = url.searchParams.get("volumeOnly") === "1";
  const symbolsRaw = url.searchParams.get("symbols") ?? "";
  const symbols = symbolsRaw
    ? symbolsRaw.split(/[,;\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean)
    : undefined;

  try {
    const r = await screenCandlestickPatterns({
      category,
      minScore: Number.isFinite(minScore) ? minScore : 55,
      limit: Number.isFinite(limit) ? limit : 40,
      volumeOnly,
      symbols,
    });
    const payload = r ?? {
      rows: [],
      scanned: 0,
      skipped: 0,
      meta: { source: "candlestick-screener", sourceTimestampMs: Date.now(), hasData: false, partial: true,
        note: "OHLCV tạm lỗi — thử lại sau" },
    };
    return ok(
      {
        rows: payload.rows,
        scanned: payload.scanned,
        skipped: payload.skipped,
        ruleset: "candlestick-ruleset.json v1.0",
        alertPolicy: "reversal-only (high|very_high + volume gate)",
      },
      payload.meta,
    );
  } catch (e) {
    return unavailable(
      "candlestick-screener",
      e instanceof Error ? e.message : "scan failed",
    );
  }
}
