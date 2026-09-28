import "server-only";
import { analyzeScalp } from "../engines/scalp";
import { detectDivergences } from "../engines/divergence";
import type { OhlcvBar } from "../types";
import type { ChartAssetType, ChartCandle } from "../chart-const";

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

export {
  getChartHistory,
  computeIndicators,
  isChartableCommodity,
  canonicalIndexSymbol,
  validateIndexCandles,
} from "./chart-history";
