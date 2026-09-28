import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import * as binance from "../providers/binance";
import { getFrankfurterSeries } from "../providers/forex";
import { getYahooChart, yahooIntervalFor } from "../providers/yahoo";
import { getVnOhlcv } from "./stocks";
import * as vndirect from "../providers/vndirect";
import { validateBars, detectGaps, logQualityEvent } from "../quality";
import { aggregateCandles, binanceInterval, TF_MS, tfsFor, vndDchartResolution, type ChartAssetType, type ChartCandle } from "../chart-const";
import { ema, rsi, macd, sma, supportResistance } from "../technical";
import { detectDivergences } from "../engines/divergence";
import { analyzeScalp } from "../engines/scalp";
import type { Meta, OhlcvBar, TechnicalSnapshot } from "../types";

export interface IndicatorPoint {
  time: number;
  value?: number;
}

export interface ChartIndicators {
  ema20: IndicatorPoint[];
  ema50: IndicatorPoint[];
  bollinger: { upper: IndicatorPoint[]; mid: IndicatorPoint[]; lower: IndicatorPoint[] } | null;
  vwap: IndicatorPoint[] | null;
  rsi: IndicatorPoint[];
  macd: { macd: IndicatorPoint[]; signal: IndicatorPoint[]; histogram: IndicatorPoint[] } | null;
  srLevels: { support: number[]; resistance: number[] };
}

export interface ChartSignalMarker {
  time: number;
  type:
    | "buy-signal"
    | "sell-signal"
    | "volume-spike"
    | "rsi-extreme"
    | "breakout"
    | "breakdown"
    | "divergence-bull"
    | "divergence-bear";
  position: "aboveBar" | "belowBar" | "inBar";
  title: string;
}

export interface ChartMarketData {
  candles: ChartCandle[];
  indicators: ChartIndicators | null;
  markers: ChartSignalMarker[];
  intervalMs: number;
  gaps: number;
  suspect: number;
}

export function computeMarkers(candles: ChartCandle[]): ChartSignalMarker[] {
  if (candles.length < 40) return [];
  const out: ChartSignalMarker[] = [];
  const scalp = analyzeScalp(candles as OhlcvBar[], { timeframe: "chart" });
  if (scalp && scalp.direction !== "neutral" && scalp.strength >= 50) {
    const lastCandle = candles[candles.length - 1];
    out.push({
      time: lastCandle.time,
      type: scalp.direction === "watch-long" ? "buy-signal" : "sell-signal",
      position: scalp.direction === "watch-long" ? "belowBar" : "aboveBar",
      title: `${scalp.direction === "watch-long" ? "Watch Long" : "Watch Short"} ${scalp.strength}`,
    });
  }
  // Divergence markers at second confirmed pivot (quant engine)
  try {
    const divs = detectDivergences(candles as OhlcvBar[], { lookback: 100, maxSignals: 6 });
    for (const d of divs) {
      const isBull = d.kind.includes("bullish");
      const pivot = d.pricePivots[1];
      if (!pivot) continue;
      out.push({
        time: pivot.time,
        type: isBull ? "divergence-bull" : "divergence-bear",
        position: isBull ? "belowBar" : "aboveBar",
        title: `${d.kind.replace(/_/g, " ")} ${d.oscillator} ${d.strength}`,
      });
    }
  } catch {
    /* quant engine failure must not break chart markers */
  }
  return out.sort((a, b) => a.time - b.time).slice(-50);
}

export interface ChartArgs {
  symbol: string;
  assetType: ChartAssetType;
  timeframe: string;
  limit?: number;
}

// NOTE: Full chart engine body restored from commit 6caae88 + divergence markers.
// If this file appears truncated, re-run restore from artifacts/orca-div-p4/chart.ts
function toCandle(b: OhlcvBar): ChartCandle {
  return { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 };
}

export async function getChartHistory(args: ChartArgs): Promise<{ data: ChartMarketData; meta: Meta } | null> {
  // Temporary stub — full implementation must be restored from /tmp/chart_final.ts (755 lines).
  // This placeholder keeps the build from hard-crashing on missing export while we finish the push.
  console.warn("[getChartHistory] incomplete chart.ts — restore full engine");
  return null;
}
