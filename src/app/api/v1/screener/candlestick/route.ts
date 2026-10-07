import { ok, unavailable, badRequest } from "@/lib/envelope";
import {
  getRecentPatternAlerts,
  screenCandlestickPatterns,
  screenCryptoCandlePatterns,
  screenForexCandlePatterns,
  screenMultiAssetCandlePatterns,
} from "@/lib/services/candlestick-screener";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 90;

/**
 * GET /api/v1/screener/candlestick
 *   ?category=bullish_reversal|bearish_reversal|continuation|all
 *   &minScore=55&limit=40&volumeOnly=1&symbols=VCB,FPT
 *   &asset=stock|crypto|forex|multi  (default stock; multi = VN+crypto+XAU/majors)
 *   &recent=1  → reversal alerts already fired
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
  const asset = (url.searchParams.get("asset") ?? "stock").toLowerCase();
  if (!["stock", "crypto", "forex", "multi"].includes(asset)) {
    return badRequest("asset phải là stock|crypto|forex|multi");
  }
  const minScore = Number(url.searchParams.get("minScore") ?? (asset === "stock" ? 55 : 48));
  const limit = Number(url.searchParams.get("limit") ?? 40);
  const volumeOnly = url.searchParams.get("volumeOnly") === "1";
  const symbolsRaw = url.searchParams.get("symbols") ?? "";
  const symbols = symbolsRaw
    ? symbolsRaw.split(/[,;\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean)
    : undefined;

  try {
    const opts = {
      category,
      minScore: Number.isFinite(minScore) ? minScore : 55,
      limit: Number.isFinite(limit) ? limit : 40,
      volumeOnly,
      symbols,
      assetClass: (asset === "multi" ? "stock" : asset) as "stock" | "forex" | "crypto",
    };
    const r =
      asset === "multi"
        ? await screenMultiAssetCandlePatterns(opts)
        : asset === "crypto"
          ? await screenCryptoCandlePatterns(opts)
          : asset === "forex"
            ? await screenForexCandlePatterns(opts)
            : await screenCandlestickPatterns(opts);

    const payload = r ?? {
      rows: [],
      scanned: 0,
      skipped: 0,
      meta: {
        source: "candlestick-screener",
        sourceTimestampMs: Date.now(),
        hasData: false,
        partial: true,
        note: "OHLCV tạm lỗi — thử lại sau",
      },
    };
    return ok(
      {
        rows: payload.rows,
        scanned: payload.scanned,
        skipped: payload.skipped,
        asset,
        legs: "legs" in payload ? (payload as { legs?: unknown }).legs : undefined,
        ruleset: "candlestick-engine multi-bar + soft FX/crypto",
        alertPolicy: "reversal-only (high|very_high + volume gate when available)",
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
