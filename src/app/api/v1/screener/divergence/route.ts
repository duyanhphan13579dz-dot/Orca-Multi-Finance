import { ok, unavailable, badRequest } from "@/lib/envelope";
import {
  getRecentDivergenceAlerts,
  screenCryptoDivergences,
  screenMultiAssetDivergences,
  screenVnDivergences,
  warmVnDivergenceScreen,
} from "@/lib/services/divergence-screener";
import type { DivergenceKind, DivergenceOscillator, DivergenceStrength } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 90;

const KINDS = new Set([
  "any",
  "regular_bullish",
  "regular_bearish",
  "hidden_bullish",
  "hidden_bearish",
]);
const OSC = new Set(["any", "rsi", "macd_hist", "macd_line", "stoch"]);
const STR = new Set(["A", "B", "C"]);

/**
 * GET /api/v1/screener/divergence
 *   ?asset=stock|crypto|multi
 *   &kind=regular_bullish|…|any
 *   &oscillator=rsi|macd_hist|macd_line|stoch|any
 *   &minStrength=A|B|C
 *   &timeframe=1d|1h|4h
 *   &window=short_3_4d|default
 *   &limit=40&symbols=VCB,FPT
 *   &skipCache=1  → force recompute
 *   &warm=1      → pre-warm default VN short screen only
 *   &recent=1    → alerts already fired by cron
 */
export async function GET(req: Request) {
  const url = new URL(req.url);

  if (url.searchParams.get("recent") === "1") {
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 20) || 20, 50);
    const events = getRecentDivergenceAlerts(limit);
    return ok({
      events,
      count: events.length,
      note: "Cảnh báo phân kỳ đã bắn bởi cron (dedupe theo ngày)",
    });
  }

  if (url.searchParams.get("warm") === "1") {
    const warm = await warmVnDivergenceScreen();
    return ok({
      warm,
      note: "Đã làm nóng cache màn phân kỳ VN short_3_4d",
    });
  }

  const asset = (url.searchParams.get("asset") ?? "stock").toLowerCase();
  if (!["stock", "crypto", "multi"].includes(asset)) {
    return badRequest("asset phải là stock|crypto|multi");
  }

  const kindRaw = (url.searchParams.get("kind") ?? "any").toLowerCase();
  if (!KINDS.has(kindRaw)) return badRequest("kind không hợp lệ");

  const oscRaw = (url.searchParams.get("oscillator") ?? "any").toLowerCase();
  if (!OSC.has(oscRaw)) return badRequest("oscillator không hợp lệ");

  const minStrength = (url.searchParams.get("minStrength") ?? "C").toUpperCase();
  if (!STR.has(minStrength)) return badRequest("minStrength phải là A|B|C");

  const windowRaw = (url.searchParams.get("window") ?? "short_3_4d").toLowerCase();
  const window = windowRaw === "default" ? "default" : "short_3_4d";

  const timeframe = url.searchParams.get("timeframe") ?? (asset === "crypto" ? "1h" : "1d");
  const limit = Number(url.searchParams.get("limit") ?? 40);
  const skipCache =
    url.searchParams.get("skipCache") === "1" || url.searchParams.get("fresh") === "1";
  const symbolsRaw = url.searchParams.get("symbols") ?? "";
  const symbols = symbolsRaw
    ? symbolsRaw
        .split(/[,;\s]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    : undefined;

  const opts = {
    kind: kindRaw as DivergenceKind | "any",
    oscillator: oscRaw as DivergenceOscillator | "any",
    minStrength: minStrength as DivergenceStrength,
    timeframe,
    limit: Number.isFinite(limit) ? limit : 40,
    symbols,
    window: window as "default" | "short_3_4d",
    skipCache,
  };

  try {
    const r =
      asset === "multi"
        ? await screenMultiAssetDivergences(opts)
        : asset === "crypto"
          ? await screenCryptoDivergences(opts)
          : await screenVnDivergences(opts);

    return ok(
      {
        rows: r.rows,
        scanned: r.scanned,
        skipped: r.skipped,
        asset,
        legs: "legs" in r ? (r as { legs?: unknown }).legs : undefined,
        filters: {
          kind: opts.kind,
          oscillator: opts.oscillator,
          minStrength: opts.minStrength,
          timeframe: opts.timeframe,
          window: opts.window,
        },
        engine: "phân kỳ · short 3–4d · vol-confirm · cache+OHLCV batch",
      },
      r.meta,
    );
  } catch (e) {
    return unavailable(
      "divergence-screener",
      e instanceof Error ? e.message : "scan failed",
    );
  }
}
