import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import * as binance from "../providers/binance";
import { getYahooChart, yahooIntervalFor, yahooSymbolForPair } from "../providers/yahoo";
import { getBiquotePublicOhlc, biquoteIntervalFor } from "../providers/forex";
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
  return { candles, source: (res?.meta as { source?: string } | undefined)?.source ?? "vnstock" };
}

async function yahooCandles(symbol: string, tf: string, _limit: number): Promise<CandleSeriesResult> {
  const cfg = yahooIntervalFor(tf);
  if (!cfg) return { candles: [], source: "yahoo", note: `tf ${tf} unsupported` };
  const raw = await getYahooChart(symbol, cfg.interval, cfg.range);
  const candles = raw?.candles ?? [];
  return { candles, source: "yahoo" };
}

/**
 * Forex / metals / oil chart candles.
 * Primary: Biquote public OHLC (real-time MT5, no key).
 * Fallback: Yahoo Finance (=X / GC=F / SI=F).
 */
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
      /* fall through to Yahoo */
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
    const cacheKey = `chart:v4:${args.assetType}:${symbol}:${tf}:${limit}`;
    const res = await cached(cacheKey, {
      ttlMs: args.assetType === "crypto" ? 30_000 : args.assetType === "forex" || args.assetType === "commodity" ? 45_000 : 60_000,
      staleMs: args.assetType === "crypto" ? 120_000 : 300_000,
      producer: async () => {
        let series: CandleSeriesResult;
        if (args.assetType === "crypto") {
          series = await cryptoCandles(symbol, tf, limit);
        } else if (args.assetType === "stock") {
          series = await stockCandles(symbol, limit);
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
        const gaps = gapFlag && typeof gapFlag.value === "number" ? gapFlag.value : gapFlag ? 1 : 0;
        const suspect = quality.status === "SUSPECT" || quality.status === "INVALID" ? 1 : 0;

        return {
          candles: cleaned,
          source: series.source,
          note: series.note,
          gaps,
          suspect,
          qualityStatus: quality.status,
        };
      },
    });

    const series = res.value;
    const candles = series.candles ?? [];
    if (!candles.length) return null;

    const indicators = computeIndicators(candles);
    const markers = computeMarkers(candles);
    const data: ChartMarketData = {
      symbol,
      assetType: args.assetType,
      timeframe: tf,
      candles,
      indicators,
      markers,
      source: series.source,
    };
    const meta = buildMeta({
      source: series.source,
      sourceTimestampMs: candles[candles.length - 1]?.time ?? null,
      cached: res.cached,
      stale: res.stale,
      note: series.note,
    });
    return { data, meta };
  } catch (e) {
    console.warn("[getChartHistory]", args.assetType, symbol, tf, e instanceof Error ? e.message : e);
    return null;
  }
}
