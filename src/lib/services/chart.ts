import "server-only";
import { analyzeScalp } from "../engines/scalp";
import type { OhlcvBar } from "../types";
import { ema, macd, rsi, sma, supportResistance } from "../technical";
import { getCryptoOhlcv } from "./crypto";
import { getForexOhlcv } from "./forex";
import { getVnOhlcv } from "./stocks";

export type ChartAssetType = "crypto" | "stock" | "forex" | "commodity";

export interface ChartCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface IndicatorPoint {
  time: number;
  value: number;
}

export interface ChartIndicators {
  ema20: IndicatorPoint[];
  ema50: IndicatorPoint[];
  sma20: IndicatorPoint[];
  bbUpper: IndicatorPoint[];
  bbMid: IndicatorPoint[];
  bbLower: IndicatorPoint[];
  vwap: IndicatorPoint[];
  rsi: IndicatorPoint[];
  macd: IndicatorPoint[];
  macdSignal: IndicatorPoint[];
  macdHist: IndicatorPoint[];
  support: number | null;
  resistance: number | null;
}

export interface ChartSignalMarker {
  time: number;
  type: "buy-signal" | "sell-signal" | "volume-spike" | "rsi-extreme" | "breakout" | "breakdown";
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

/** deterministic markers — scalp signal only (Vol/RSI dots removed from chart). */
export function computeMarkers(candles: ChartCandle[]): ChartSignalMarker[] {
  if (candles.length < 40) return [];
  const out: ChartSignalMarker[] = [];
  // volume-spike (yellow Vol xN) and rsi-extreme (purple RSI N) intentionally omitted —
  // they clutter the price pane; RSI/Vol remain available as separate indicator panes.
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
  return out.sort((a, b) => a.time - b.time).slice(-50);
}

export interface ChartArgs {
  symbol: string;
  assetType: ChartAssetType;
  timeframe: string;
  limit?: number;
}

function toCandle(b: OhlcvBar): ChartCandle {
  return { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
}

function points(times: number[], values: (number | null)[]): IndicatorPoint[] {
  // Keep denser series for longer history (up to ~1200 points for smooth pan/zoom)
  const step = values.length > 1200 ? Math.ceil(values.length / 1200) : 1;
  const out: IndicatorPoint[] = [];
  for (let i = 0; i < times.length; i++) {
    if (i % step !== 0 && i !== times.length - 1) continue;
    const v = values[i];
    if (v == null || !Number.isFinite(v)) continue;
    out.push({ time: times[i], value: v });
  }
  return out;
}

function bollinger(
  closes: number[],
  period = 20,
  mult = 2,
): { upper: (number | null)[]; mid: (number | null)[]; lower: (number | null)[] } {
  const mid = sma(closes, period);
  const upper: (number | null)[] = Array(closes.length).fill(null);
  const lower: (number | null)[] = Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = mid[i];
    if (mean == null) continue;
    const variance = slice.reduce((s, x) => s + (x - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    upper[i] = mean + mult * std;
    lower[i] = mean - mult * std;
  }
  return { upper, mid, lower };
}

function computeVwap(candles: ChartCandle[]): (number | null)[] {
  const out: (number | null)[] = Array(candles.length).fill(null);
  let cumPv = 0;
  let cumV = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const typ = (c.high + c.low + c.close) / 3;
    const v = c.volume ?? 0;
    if (v <= 0) {
      out[i] = cumV > 0 ? cumPv / cumV : null;
      continue;
    }
    cumPv += typ * v;
    cumV += v;
    out[i] = cumPv / cumV;
  }
  return out;
}

export function buildIndicators(candles: ChartCandle[]): ChartIndicators | null {
  if (candles.length < 30) return null;
  const times = candles.map((c) => c.time);
  const closes = candles.map((c) => c.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const sma20 = sma(closes, 20);
  const bb = bollinger(closes, 20, 2);
  const vwap = computeVwap(candles);
  const rsiArr = rsi(closes, 14);
  const m = macd(closes);
  const sr = supportResistance(candles as OhlcvBar[]);

  return {
    ema20: points(times, ema20),
    ema50: points(times, ema50),
    sma20: points(times, sma20),
    bbUpper: points(times, bb.upper),
    bbMid: points(times, bb.mid),
    bbLower: points(times, bb.lower),
    vwap: points(times, vwap),
    rsi: points(times, rsiArr),
    macd: points(times, m.macd),
    macdSignal: points(times, m.signal),
    macdHist: points(times, m.histogram),
    support: sr.support,
    resistance: sr.resistance,
  };
}

const TF_MS: Record<string, number> = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "6h": 21_600_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
  "1w": 604_800_000,
};

function detectGaps(candles: ChartCandle[], intervalMs: number): number {
  if (candles.length < 2 || intervalMs <= 0) return 0;
  let gaps = 0;
  for (let i = 1; i < candles.length; i++) {
    const dt = candles[i].time - candles[i - 1].time;
    if (dt > intervalMs * 2.5) gaps++;
  }
  return gaps;
}

function countSuspect(candles: ChartCandle[]): number {
  let n = 0;
  for (const c of candles) {
    if (c.high < c.low || c.open <= 0 || c.close <= 0) n++;
    else if (c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close)) n++;
  }
  return n;
}

async function loadBars(args: ChartArgs): Promise<OhlcvBar[] | null> {
  const limit = Math.min(Math.max(args.limit ?? 300, 50), 2000);
  const sym = args.symbol.toUpperCase();
  try {
    if (args.assetType === "crypto") {
      const r = await getCryptoOhlcv(sym, args.timeframe, limit);
      return r?.bars ?? null;
    }
    if (args.assetType === "stock") {
      const r = await getVnOhlcv(sym, limit);
      return r?.bars ?? null;
    }
    if (args.assetType === "forex" || args.assetType === "commodity") {
      const r = await getForexOhlcv(sym, limit);
      return r?.bars ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

export async function getChartMarketData(args: ChartArgs): Promise<ChartMarketData | null> {
  const bars = await loadBars(args);
  if (!bars?.length) return null;
  const candles = bars.map(toCandle);
  const intervalMs = TF_MS[args.timeframe] ?? 86_400_000;
  return {
    candles,
    indicators: buildIndicators(candles),
    markers: computeMarkers(candles),
    intervalMs,
    gaps: detectGaps(candles, intervalMs),
    suspect: countSuspect(candles),
  };
}
