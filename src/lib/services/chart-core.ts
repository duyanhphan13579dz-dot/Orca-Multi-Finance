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
        title: `${d.kind.replace(/_/g, " ")} ${d.oscillator} ${d.strength}${d.structure && d.structure !== "single" ? ` ${d.structure}` : ""}`,
      });
    }
  } catch {
    /* quant engine failure must not break chart markers */
  }
  return out.sort((a, b) => a.time - b.time).slice(-50);
}

export function toCandle(b: OhlcvBar): ChartCandle {
  return { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
}

export function scaleVnStockToFullVnd(candles: ChartCandle[]): ChartCandle[] {
  if (!candles.length) return candles;
  const sample = candles.slice(-20);
  const avg = sample.reduce((s, c) => s + c.close, 0) / sample.length;
  if (avg > 500) return candles;
  return candles.map((c) => ({
    time: c.time,
    open: c.open * 1000,
    high: c.high * 1000,
    low: c.low * 1000,
    close: c.close * 1000,
    volume: c.volume,
  }));
}

function points(times: number[], values: (number | null)[]): IndicatorPoint[] {
  const step = times.length > 1200 ? Math.ceil(times.length / 1200) : 1;
  const out: IndicatorPoint[] = [];
  for (let i = 0; i < times.length; i++) {
    if (i % step !== 0 && i !== times.length - 1) continue;
    const v = values[i];
    if (v == null || !Number.isFinite(v)) continue;
    out.push({ time: times[i], value: v });
  }
  return out;
}

function bollingerSeries(closes: number[], times: number[], period = 20, mult = 2) {
  const midArr = sma(closes, period);
  const upper: IndicatorPoint[] = [];
  const mid: IndicatorPoint[] = [];
  const lower: IndicatorPoint[] = [];
  for (let i = period - 1; i < closes.length; i++) {
    const mean = midArr[i];
    if (mean == null) continue;
    const slice = closes.slice(i - period + 1, i + 1);
    const variance = slice.reduce((s, x) => s + (x - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    mid.push({ time: times[i], value: mean });
    upper.push({ time: times[i], value: mean + mult * std });
    lower.push({ time: times[i], value: mean - mult * std });
  }
  return { upper, mid, lower };
}

function vwapSeries(bars: ChartCandle[]): IndicatorPoint[] | null {
  const out: IndicatorPoint[] = [];
  let cumPv = 0;
  let cumV = 0;
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
  const bb = bollingerSeries(closes, times, 20, 2);
  const vwap = vwapSeries(candles);
  const rsiArr = points(times, rsi(closes, 14));
  const m = macd(closes);
  // macd() returns { macd, signal, histogram } — never .line
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
  "^HNX": "HNXINDEX",
  "HNX-INDEX": "HNXINDEX",
  UPCOM: "UPCOMINDEX",
  UPCOMINDEX: "UPCOMINDEX",
  "^UPCOM": "UPCOMINDEX",
  "UPCOM-INDEX": "UPCOMINDEX",
};

export function canonicalIndexSymbol(symbol: string): string | null {
  const s = symbol.toUpperCase().replace(/\s/g, "");
  return INDEX_MAP[s] ?? null;
}

const INDEX_LIMITS: Record<string, { min: number; max: number }> = {
  VNINDEX: { min: 100, max: 3000 },
  HNXINDEX: { min: 50, max: 500 },
  UPCOMINDEX: { min: 20, max: 200 },
};

export function validateIndexCandles(symbol: string, candles: ChartCandle[]) {
  const code = canonicalIndexSymbol(symbol);
  if (!code) return { valid: candles, rejected: 0 };
  const bounds = INDEX_LIMITS[code];
  const valid = candles.filter((c) =>
    [c.open, c.high, c.low, c.close].every(
      (v) => Number.isFinite(v) && v >= bounds.min && v <= bounds.max && c.high >= c.low,
    ),
  );
  return {
    valid,
    rejected: candles.length - valid.length,
    reason: valid.length !== candles.length ? `${code}: candle ngoai bien` : undefined,
  };
}
