import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import * as binance from "../providers/binance";
import { getYahooChart, yahooIntervalFor } from "../providers/yahoo";
import { getVnOhlcv } from "./stocks";
import { validateBars, detectGaps } from "../quality";
import {
  binanceInterval,
  TF_MS,
  tfsFor,
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

async function stockCandles(symbol: string, limit: number): Promise<CandleSeriesResult> {
  const res = await getVnOhlcv(symbol, Math.min(limit, 500));
  const bars = res?.bars ?? [];
  let candles: ChartCandle[] = bars.map((b) => toCandle(b));
  candles = scaleVnStockToFullVnd(candles);
  const idx = canonicalIndexSymbol(symbol);
  if (idx) {
    const v = validateIndexCandles(symbol, candles);
    candles = v.valid;
  }
  return { candles, source: res?.meta?.source ?? "vnstock" };
}

async function yahooCandles(symbol: string, tf: string, _limit: number): Promise<CandleSeriesResult> {
  const cfg = yahooIntervalFor(tf);
  if (!cfg) return { candles: [], source: "yahoo", note: `tf ${tf} unsupported` };
  const raw = await getYahooChart(symbol, cfg.interval, cfg.range);
  const candles = raw?.candles ?? [];
  return { candles, source: "yahoo" };
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
    const cacheKey = `chart:v3:${args.assetType}:${symbol}:${tf}:${limit}`;
    const res = await cached(cacheKey, {
      ttlMs: args.assetType === "crypto" ? 30_000 : 60_000,
      staleMs: args.assetType === "crypto" ? 120_000 : 300_000,
      producer: async () => {
        let series: CandleSeriesResult;
        if (args.assetType === "crypto") {
          series = await cryptoCandles(symbol, tf, limit);
        } else if (args.assetType === "stock" || args.assetType === "index") {
          series = await stockCandles(symbol, limit);
        } else {
          series = await yahooCandles(symbol, tf, limit);
        }

        let candles = series.candles;
        if (candles.length > limit) candles = candles.slice(-limit);

        const quality = validateBars(candles as OhlcvBar[]);
        const cleaned = (quality.cleaned ?? candles) as ChartCandle[];
        const gapFlag = detectGaps(cleaned as OhlcvBar[], TF_MS[tf] ?? 86_400_000);
        const gaps = gapFlag && typeof gapFlag.value === "number" ? gapFlag.value : gapFlag ? 1 : 0;
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
          ? { liveSlaMs: TF_MS[tf] * 1.5, freshSlaMs: TF_MS[tf] * 4, delayedSlaMs: TF_MS[tf] * 12 }
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
      },
      meta,
    };
  } catch (e) {
    console.warn("[getChartHistory]", args.assetType, symbol, tf, e instanceof Error ? e.message : e);
    return null;
  }
}
