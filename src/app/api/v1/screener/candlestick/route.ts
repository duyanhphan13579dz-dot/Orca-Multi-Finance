import { badRequest, ok } from "@/lib/envelope";
import {
  getRecentPatternAlerts,
  screenCandlestickPatterns,
  screenCryptoCandlePatterns,
  screenForexCandlePatterns,
  screenMultiAssetCandlePatterns,
} from "@/lib/services/candlestick-screener";
import { safeApi } from "@/lib/safe-api";
import { WORKERS_BUDGET } from "@/lib/data-engine/workers-budget";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/** GET /api/v1/screener/candlestick */
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

  return safeApi({
    label: "screener-candlestick",
    guard: {
      wallMs: WORKERS_BUDGET.techScreenWallMs,
      maxSubrequests: 24,
      maxConcurrent: 3,
    },
    produce: async () => {
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
      if (!r) return null;
      return {
        data: {
          rows: r.rows,
          scanned: r.scanned,
          skipped: r.skipped,
          asset,
          legs: "legs" in r ? (r as { legs?: unknown }).legs : undefined,
          ruleset: "candlestick-engine multi-bar + soft FX/crypto",
          alertPolicy: "reversal-only (high|very_high + volume gate when available)",
        },
        meta: r.meta,
      };
    },
    fallback: async () => ({
      data: {
        rows: [],
        scanned: 0,
        skipped: 0,
        asset,
        legs: undefined,
        ruleset: "candlestick-engine multi-bar + soft FX/crypto",
        alertPolicy: "reversal-only (high|very_high + volume gate when available)",
      },
      meta: {
        source: "candlestick-shell",
        partial: true,
        stale: true,
        note: "OHLCV tạm lỗi — thử lại sau",
      },
    }),
    unavailableSource: "candlestick-screener",
    unavailableNote: "Candlestick screener tạm không khả dụng",
  });
}
