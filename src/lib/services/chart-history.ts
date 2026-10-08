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
  type Cand = { candles: ChartCandle[]; source: string };
  const jobs: Promise<Cand | null>[] = [
    (async () => {
      try {
        const raw = await Promise.race([
          binance.getKlinesDeep(symbol, interval, Math.min(limit, 5000)),
          new Promise<null>((r) => setTimeout(() => r(null), 12_000)),
        ]);
        if (!raw?.length) return null;
        return {
          candles: raw.map((k) => ({
            time: k.time,
            open: k.open,
            high: k.high,
            low: k.low,
            close: k.close,
            volume: k.volume,
          })),
          source: "binance",
        };
      } catch {
        return null;
      }
    })(),
    (async () => {
      try {
        const { yahooCryptoSymbol } = await import("../providers/yahoo");
        const ySym = yahooCryptoSymbol(symbol);
        const cfg = yahooIntervalFor(tf);
        if (!cfg) return null;
        const y = await Promise.race([
          getYahooChart(ySym, cfg.interval, cfg.range),
          new Promise<null>((r) => setTimeout(() => r(null), 12_000)),
        ]);
        const raw = y?.candles ?? [];
        if (raw.length < 10) return null;
        return {
          candles: raw.slice(-limit).map((c) => ({
            time: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume ?? 0,
          })),
          source: "yahoo-crypto",
        };
      } catch {
        return null;
      }
    })(),
  ];
  const settled = await Promise.all(jobs);
  const ok = settled.filter((x): x is Cand => Boolean(x?.candles?.length));
  if (!ok.length) return { candles: [], source: "none", note: "crypto chart: binance+yahoo empty" };
  ok.sort((a, b) => {
    if (a.source === "binance" && b.source !== "binance") return -1;
    if (b.source === "binance" && a.source !== "binance") return 1;
    return b.candles.length - a.candles.length;
  });
  return {
    candles: ok[0]!.candles,
    source: ok.map((x) => x.source).filter((s, i, a) => a.indexOf(s) === i).join("+"),
  };
}
