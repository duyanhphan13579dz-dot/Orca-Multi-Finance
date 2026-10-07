import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import * as binance from "../providers/binance";
import { getYahooChart, yahooIntervalFor, yahooSymbolForPair } from "../providers/yahoo";
import { getBiquotePublicOhlc, biquoteIntervalFor } from "../providers/forex";
import { getVnOhlcv } from "./stocks";
import { validateBars, detectGaps } from "../quality";
import {
  aggregateCandles,
  binanceInterval,
  TF_MS,
  tfsFor,
  vndDchartResolution,
  type ChartAssetType,
  type ChartCandle,
} from "../chart-const";
import type { Meta, OhlcvBar } from "../types";
import {
  type ChartIndicators,
  type ChartSignalMarker,
  type ChartMarketData,
  type ChartArgs,
  type IndicatorPoint,
  computeMarkers,
  computeIndicators,
  isChartableCommodity,
  canonicalIndexSymbol,
  validateIndexCandles,
  toCandle,
  scaleVnStockToFullVnd,
} from "./chart-core";

export type {
  IndicatorPoint,
  ChartIndicators,
  ChartSignalMarker,
  ChartMarketData,
  ChartArgs,
} from "./chart-core";

export {
  computeMarkers,
  computeIndicators,
  isChartableCommodity,
  canonicalIndexSymbol,
  validateIndexCandles,
} from "./chart-core";

type CandleSeriesResult = {
  candles: ChartCandle[];
  source: string;
  note?: string;
};

function maxHistoryLimit(assetType: ChartAssetType): number {
  if (assetType === "crypto") return 1500;
  if (assetType === "forex" || assetType === "commodity") return 800;
  return 600;
}

async function cryptoCandles(symbol: string, tf: string, limit: number): Promise<CandleSeriesResult> {
  const interval = binanceInterval(tf);
  const raw = await binance.getKlinesDeep(symbol, interval, Math.min(limit, 5000));
  const candles: ChartCandle[] = (raw ?? []).map((k) => ({
    time: k.time,
    open: k.open,
    high: k.high,
    low: k.low,
    close: k.close,
    volume: k.volume,
  }));
  return { candles, source: "binance" };
}

/**
 * VN stock/index candles for a specific timeframe.
 * Native dchart: 1m/5m/15m/30m/1h/1d. Aggregated: 4h, 1w/1M/12M.
 */
async function stockCandles(symbol: string, tf: string, limit: number): Promise<CandleSeriesResult> {
  const want = Math.min(Math.max(limit, 40), 2000);
  const native = vndDchartResolution(tf);

  let resolution: "D" | "1" | "5" | "15" | "30" | "60" = "D";
  let fetchBars = want;
  if (native) {
    resolution = native;
    fetchBars = want;
  } else if (tf === "4h") {
    resolution = "60";
    fetchBars = Math.min(want * 4, 1_500);
  } else {
    resolution = "D";
    const mult = tf === "1w" ? 6 : tf === "1M" ? 24 : 280;
    fetchBars = Math.min(want * mult, 2_000);
  }

  let bars: OhlcvBar[] = [];
  let source = "vndirect-dchart";

  try {
    const { fetchVndDchartHistory } = await import("../providers/vndirect-dchart");
    const raw = await Promise.race([
      fetchVndDchartHistory(symbol, resolution, fetchBars),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("dchart_budget")), 8_000)),
    ]);
    if (raw?.length) bars = raw;
  } catch {
    /* fall through */
  }

  let usedDailyFallback = false;
  if (!bars.length) {
    const res = await getVnOhlcv(symbol, Math.min(want, 500));
    bars = res?.bars ?? [];
    source = (res?.meta as { source?: string } | undefined)?.source ?? "vnstock";
    usedDailyFallback = true;
  }

  let candles: ChartCandle[] = (bars ?? []).map((b) => toCandle(b));
  candles = scaleVnStockToFullVnd(candles);

  if (!native && !usedDailyFallback) {
    const tfMs = TF_MS[tf];
    if (tfMs && candles.length) candles = aggregateCandles(candles, tfMs);
  } else if (!native && usedDailyFallback) {
    if (tf === "1w" || tf === "1M" || tf === "12M") {
      const tfMs = TF_MS[tf];
      if (tfMs && candles.length) candles = aggregateCandles(candles, tfMs);
    }
  }

  if (usedDailyFallback && ((native && native !== "D") || tf === "4h")) {
    return {
      candles: [],
      source,
      note: `intraday ${tf} chưa có — dchart đang gián đoạn (không dùng daily giả)`,
    };
  }

  const idx = canonicalIndexSymbol(symbol);
  if (idx) {
    const v = validateIndexCandles(symbol, candles);
    candles = v.valid;
  }

  if (candles.length > want) candles = candles.slice(-want);
  return { candles, source };
}

async function yahooCandles(symbol: string, tf: string, _limit: number): Promise<CandleSeriesResult> {
  const cfg = yahooIntervalFor(tf);
  if (!cfg) return { candles: [], source: "yahoo", note: `tf ${tf} unsupported` };
  const raw = await getYahooChart(symbol, cfg.interval, cfg.range);
  const candles = raw?.candles ?? [];
  return { candles, source: "yahoo" };
}

async function forexCandles(symbol: string, tf: string, limit: number): Promise<CandleSeriesResult> {
  const pair = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (biquoteIntervalFor(tf)) {
    try {
      const bars = await getBiquotePublicOhlc(pair, tf, Math.min(limit, 1000));
      if (bars.length >= 10) {
        const candles: ChartCandle[] = bars.map((b) => ({
          time: b.time,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume ?? 0,
        }));
        return { candles, source: "biquote-public" };
      }
    } catch {
      /* fall through */
    }
  }
  const ySymbol = yahooSymbolForPair(pair);
  try {
    const cfg = yahooIntervalFor(tf);
    if (!cfg) return { candles: [], source: "yahoo", note: `tf ${tf} unsupported` };
    const raw = await getYahooChart(ySymbol, cfg.interval, cfg.range);
    const candles = raw?.candles ?? [];
    return { candles, source: "yahoo", note: candles.length ? undefined : "yahoo empty" };
  } catch (e) {
    return {
      candles: [],
      source: "none",
      note: e instanceof Error ? e.message : "forex candles unavailable",
    };
  }
}

export async function getChartHistory(
  args: ChartArgs,
): Promise<{ data: ChartMarketData; meta: Meta } | null> {
  const symbol = args.symbol.toUpperCase().replace(/[^A-Z0-9=._-]/g, "");
  const tf = args.timeframe;
  const maxL = maxHistoryLimit(args.assetType);
  const limit = Math.min(Math.max(args.limit ?? 500, 40), maxL);
  if (!tfsFor(args.assetType).includes(tf)) return null;

  try {
    const cacheKey = `chart:v6:${args.assetType}:${symbol}:${tf}:${limit}`;
    const res = await cached(cacheKey, {
      ttlMs:
        args.assetType === "crypto"
          ? 30_000
          : args.assetType === "forex" || args.assetType === "commodity"
            ? 45_000
            : 60_000,
      staleMs: args.assetType === "crypto" ? 120_000 : 300_000,
      producer: async () => {
        let series: CandleSeriesResult;
        if (args.assetType === "crypto") {
          series = await cryptoCandles(symbol, tf, limit);
        } else if (args.assetType === "stock") {
          series = await stockCandles(symbol, tf, limit);
        } else if (args.assetType === "forex" || args.assetType === "commodity") {
          series = await forexCandles(symbol, tf, limit);
        } else {
          series = await yahooCandles(symbol, tf, limit);
        }

        let candles = series.candles;
        if (candles.length > limit) candles = candles.slice(-limit);

        const quality = validateBars(candles as OhlcvBar[]);
        const cleaned = (quality.cleaned ?? candles) as ChartCandle[];
        const gapFlag = detectGaps(cleaned as OhlcvBar[], TF_MS[tf] ?? 86_400_000);
        const gaps =
          gapFlag && typeof (gapFlag as { value?: number }).value === "number"
            ? (gapFlag as { value: number }).value
            : gapFlag
              ? 1
              : 0;
        const suspect = quality.status === "SUSPECT" || quality.status === "INVALID" ? 1 : 0;

        return {
          candles: cleaned,
          source: series.source,
          note: series.note,
          gaps,
          suspect,
        };
      },
    });

    const { candles, source, note, gaps, suspect } = res.value;
    if (!candles.length) return null;

    const last = candles[candles.length - 1];
    let indicators: ChartIndicators | null = null;
    let markers: ChartSignalMarker[] = [];
    try {
      indicators = computeIndicators(candles as ChartCandle[]);
    } catch {
      indicators = null;
    }
    try {
      markers = computeMarkers(candles as ChartCandle[]);
    } catch {
      markers = [];
    }

    const meta = buildMeta({
      source,
      sourceTimestampMs: last?.time ?? Date.now(),
      cached: res.cached,
      stale: res.stale,
      note:
        [note, gaps ? `${gaps} khoảng trống` : null, suspect ? "quality: SUSPECT" : null]
          .filter(Boolean)
          .join(" · ") || undefined,
      slas:
        args.assetType === "crypto"
          ? { liveSlaMs: TF_MS[tf]! * 1.5, freshSlaMs: TF_MS[tf]! * 4, delayedSlaMs: TF_MS[tf]! * 12 }
          : { liveSlaMs: 5 * 60_000, freshSlaMs: 30 * 60_000, delayedSlaMs: 6 * 3_600_000 },
    });

    return {
      data: {
        candles: candles as ChartCandle[],
        indicators,
        markers,
        intervalMs: TF_MS[tf] ?? 86_400_000,
        gaps,
        suspect,
        timeframe: tf,
      },
      meta,
    };
  } catch (e) {
    console.warn("[getChartHistory]", args.assetType, symbol, tf, e instanceof Error ? e.message : e);
    return null;
  }
}
