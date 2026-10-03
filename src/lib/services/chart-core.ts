import "server-only";
import { ema, rsi, macd, sma, supportResistance } from "../technical";
import { detectDivergences } from "../engines/divergence";
import { analyzeScalp } from "../engines/scalp";
import type { OhlcvBar } from "../types";
import type { ChartAssetType, ChartCandle } from "../chart-const";

export interface IndicatorPoint {
  time: number;
  value?: number;
}

export interface ChartIndicators {
  ema20: IndicatorPoint[];
  ema50: IndicatorPoint[];
  ma10: IndicatorPoint[];
  ma20: IndicatorPoint[];
  ma50: IndicatorPoint[];
  ma100: IndicatorPoint[];
  ma200: IndicatorPoint[];
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

export interface ChartArgs {
  symbol: string;
  assetType: ChartAssetType;
  timeframe: string;
  limit?: number;
}

function points(times: number[], values: (number | null)[]): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  for (let i = 0; i < times.length; i++) {
    const v = values[i];
    if (v != null && Number.isFinite(v)) out.push({ time: times[i], value: v });
  }
  return out;
}

function bollingerSeries(closes: number[], times: number[], period = 20, mult = 2) {
  const midArr = sma(closes, period);
  const upper: IndicatorPoint[] = [];
  const mid: IndicatorPoint[] = [];
  const lower: IndicatorPoint[] = [];
  for (let i = 0; i < closes.length; i++) {
    const m = midArr[i];
    if (m == null) continue;
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - period + 1); j <= i; j++) {
      sum += (closes[j] - m) ** 2;
      n++;
    }
    const sd = n > 0 ? Math.sqrt(sum / n) : 0;
    mid.push({ time: times[i], value: m });
    upper.push({ time: times[i], value: m + mult * sd });
    lower.push({ time: times[i], value: m - mult * sd });
  }
  return { upper, mid, lower };
}

function vwapSeries(bars: ChartCandle[]): IndicatorPoint[] | null {
  let cumPv = 0;
  let cumV = 0;
  const out: IndicatorPoint[] = [];
  for (const c of bars) {
    const typ = (c.high + c.low + c.close) / 3;
    const v = c.volume ?? 0;
    if (v > 0) {
      cumPv += typ * v;
      cumV += v;
    }
    if (cumV > 0) out.push({ time: c.time, value: cumPv / cumV });
  }
  return out.length ? out : null;
}

export function computeIndicators(candles: ChartCandle[]): ChartIndicators | null {
  if (candles.length < 30) return null;
  const times = candles.map((c) => c.time);
  const closes = candles.map((c) => c.close);
  const ema20 = points(times, ema(closes, 20));
  const ema50 = points(times, ema(closes, 50));
  const ma10 = points(times, sma(closes, 10));
  const ma20 = points(times, sma(closes, 20));
  const ma50 = points(times, sma(closes, 50));
  const ma100 = points(times, sma(closes, 100));
  const ma200 = points(times, sma(closes, 200));
  const bb = bollingerSeries(closes, times, 20, 2);
  const vwap = vwapSeries(candles);
  const rsiArr = points(times, rsi(closes, 14));
  const m = macd(closes);
  const hist = m.macd.map((v, i) =>
    v != null && m.signal[i] != null ? (v as number) - (m.signal[i] as number) : null,
  );
  const macdPts = {
    macd: points(times, m.macd),
    signal: points(times, m.signal),
    histogram: points(times, hist),
  };
  const ohlcv: OhlcvBar[] = candles.map((c) => ({ ...c, volume: c.volume ?? 0 }));
  const sr = supportResistance(ohlcv, Math.min(120, candles.length));
  return {
    ema20,
    ema50,
    ma10,
    ma20,
    ma50,
    ma100,
    ma200,
    bollinger: bb.upper.length ? bb : null,
    vwap,
    rsi: rsiArr,
    macd: macdPts.macd.length ? macdPts : null,
    srLevels: sr,
  };
}

const COMMODITY_CHARTABLE = new Set([
  "XAUUSD", "XAGUSD", "GC=F", "SI=F", "CL=F", "BZ=F", "NG=F", "HG=F", "PAXG",
]);

export function isChartableCommodity(symbol: string): boolean {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9=]/g, "");
  return COMMODITY_CHARTABLE.has(s) || s.includes("GOLD") || s.includes("SILVER") || s.includes("OIL");
}

const INDEX_MAP: Record<string, string> = {
  VNINDEX: "VNINDEX",
  "^VNINDEX": "VNINDEX",
  VNIND: "VNINDEX",
  VN: "VNINDEX",
  "VN-INDEX": "VNINDEX",
  "VN_INDEX": "VNINDEX",
  HNX: "HNXINDEX",
  HNXINDEX: "HNXINDEX",
};

export function normalizeIndexSymbol(symbol: string): string {
  const u = symbol.toUpperCase().replace(/\s+/g, "");
  return INDEX_MAP[u] ?? u;
}

export function computeMarkers(candles: ChartCandle[]): ChartSignalMarker[] {
  if (candles.length < 30) return [];
  const markers: ChartSignalMarker[] = [];
  const closes = candles.map((c) => c.close);
  const vols = candles.map((c) => c.volume ?? 0);
  const rsiArr = rsi(closes, 14);
  for (let i = 20; i < candles.length; i++) {
    const c = candles[i];
    const r = rsiArr[i];
    if (r != null && r >= 70) {
      markers.push({ time: c.time, type: "rsi-extreme", position: "aboveBar", title: "RSI↑" });
    } else if (r != null && r <= 30) {
      markers.push({ time: c.time, type: "rsi-extreme", position: "belowBar", title: "RSI↓" });
    }
    const avgVol = vols.slice(i - 20, i).reduce((a, b) => a + b, 0) / 20;
    if (avgVol > 0 && (c.volume ?? 0) > avgVol * 2.5) {
      markers.push({ time: c.time, type: "volume-spike", position: "inBar", title: "Vol" });
    }
  }
  return markers.slice(-40);
}
