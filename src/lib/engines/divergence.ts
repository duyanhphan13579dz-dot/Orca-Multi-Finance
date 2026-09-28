/**
 * DIVERGENCE ENGINE — deterministic regular + hidden divergence detection.
 *
 * Phase 0 contract + Phase 1 implementation.
 * Quant-only: pivots on closed bars, no LLM. Callers attach freshness/meta.
 *
 * Types: regular_bullish | regular_bearish | hidden_bullish | hidden_bearish
 * Oscillators (Phase 1): RSI(14), MACD histogram
 */

import type { OhlcvBar } from "../types";
import type {
  DivergenceKind,
  DivergenceOscillator,
  DivergenceSignal,
  DivergenceStrength,
  DivergencePivot,
} from "../types";
import { rsi, macd } from "../technical";

export interface DetectDivergenceOptions {
  /** Bars left/right of a fractal pivot (confirmed only). Default 5. */
  pivotLeft?: number;
  pivotRight?: number;
  /** Min / max bars between the two compared pivots. */
  minBarsBetween?: number;
  maxBarsBetween?: number;
  /** Max lookback bars from series end. Default 120. */
  lookback?: number;
  /** Optional timeframe label for the signal (caller supplies). */
  timeframe?: string;
  /** Which oscillators to scan. Default both. */
  oscillators?: DivergenceOscillator[];
  /** Max signals returned (most recent first). Default 8. */
  maxSignals?: number;
}

const DEFAULTS = {
  pivotLeft: 5,
  pivotRight: 5,
  minBarsBetween: 5,
  maxBarsBetween: 60,
  lookback: 120,
  oscillators: ["rsi", "macd_hist"] as DivergenceOscillator[],
  maxSignals: 8,
};

interface PivotPoint {
  index: number;
  value: number;
  /** For price pivots: high for peaks, low for troughs */
  price: number;
  time: number;
}

function findPeaks(
  values: (number | null)[],
  times: number[],
  prices: number[],
  left: number,
  right: number,
  from: number,
  to: number,
): PivotPoint[] {
  const out: PivotPoint[] = [];
  const start = Math.max(from, left);
  const end = Math.min(to, values.length - 1 - right);
  for (let i = start; i <= end; i++) {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) continue;
    let isPeak = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      const o = values[j];
      if (o != null && o >= v) {
        isPeak = false;
        break;
      }
    }
    if (isPeak) out.push({ index: i, value: v, price: prices[i], time: times[i] });
  }
  return out;
}

function findTroughs(
  values: (number | null)[],
  times: number[],
  prices: number[],
  left: number,
  right: number,
  from: number,
  to: number,
): PivotPoint[] {
  const out: PivotPoint[] = [];
  const start = Math.max(from, left);
  const end = Math.min(to, values.length - 1 - right);
  for (let i = start; i <= end; i++) {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) continue;
    let isTrough = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      const o = values[j];
      if (o != null && o <= v) {
        isTrough = false;
        break;
      }
    }
    if (isTrough) out.push({ index: i, value: v, price: prices[i], time: times[i] });
  }
  return out;
}

function toPivot(p: PivotPoint, usePrice: boolean): DivergencePivot {
  return {
    index: p.index,
    time: p.time,
    price: p.price,
    value: usePrice ? p.price : p.value,
  };
}

function strengthFor(
  kind: DivergenceKind,
  osc: DivergenceOscillator,
  firstOsc: number,
  secondOsc: number,
): DivergenceStrength {
  if (osc === "rsi") {
    if (kind === "regular_bullish" || kind === "hidden_bullish") {
      if (firstOsc <= 30) return "A";
      if (firstOsc <= 40) return "B";
      return "C";
    }
    if (firstOsc >= 70) return "A";
    if (firstOsc >= 60) return "B";
    return "C";
  }
  const mag = Math.abs(firstOsc);
  const mag2 = Math.abs(secondOsc);
  if (mag > 0 && mag2 / Math.max(mag, 1e-12) < 0.85) {
    if (mag >= mag2 * 1.5) return "A";
    return "B";
  }
  return "C";
}

function confidenceFor(
  strength: DivergenceStrength,
  barsBetween: number,
  minBars: number,
  maxBars: number,
): number {
  let c = strength === "A" ? 0.82 : strength === "B" ? 0.62 : 0.42;
  const mid = (minBars + maxBars) / 2;
  const dist = Math.abs(barsBetween - mid) / Math.max(maxBars - minBars, 1);
  c -= dist * 0.12;
  return Math.max(0.15, Math.min(0.95, Math.round(c * 100) / 100));
}

function nearestPivot(pivots: PivotPoint[], index: number): PivotPoint | null {
  let best: PivotPoint | null = null;
  let bestDist = Infinity;
  for (const p of pivots) {
    const d = Math.abs(p.index - index);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return bestDist <= 3 ? best : null;
}

function pairDivergences(
  pricePeaks: PivotPoint[],
  priceTroughs: PivotPoint[],
  oscPeaks: PivotPoint[],
  oscTroughs: PivotPoint[],
  osc: DivergenceOscillator,
  minBars: number,
  maxBars: number,
  timeframe: string | undefined,
): DivergenceSignal[] {
  const signals: DivergenceSignal[] = [];

  const tryPair = (
    kind: DivergenceKind,
    priceA: PivotPoint,
    priceB: PivotPoint,
    oscA: PivotPoint,
    oscB: PivotPoint,
    priceOk: boolean,
    oscOk: boolean,
  ) => {
    if (!priceOk || !oscOk) return;
    const barsBetween = priceB.index - priceA.index;
    if (barsBetween < minBars || barsBetween > maxBars) return;
    if (Math.abs(oscA.index - priceA.index) > 3 || Math.abs(oscB.index - priceB.index) > 3) return;

    const strength = strengthFor(kind, osc, oscA.value, oscB.value);
    const confidence = confidenceFor(strength, barsBetween, minBars, maxBars);
    const confirmedAt = new Date(priceB.time).toISOString();

    signals.push({
      kind,
      oscillator: osc,
      timeframe: timeframe ?? null,
      strength,
      confidence,
      barsBetween,
      pricePivots: [toPivot(priceA, true), toPivot(priceB, true)],
      oscPivots: [toPivot(oscA, false), toPivot(oscB, false)],
      confirmed: true,
      confirmedAt,
      forming: false,
    });
  };

  for (let i = 0; i < priceTroughs.length - 1; i++) {
    for (let j = i + 1; j < priceTroughs.length; j++) {
      const p1 = priceTroughs[i];
      const p2 = priceTroughs[j];
      const o1 = nearestPivot(oscTroughs, p1.index);
      const o2 = nearestPivot(oscTroughs, p2.index);
      if (!o1 || !o2) continue;
      tryPair("regular_bullish", p1, p2, o1, o2, p2.price < p1.price, o2.value > o1.value);
    }
  }

  for (let i = 0; i < pricePeaks.length - 1; i++) {
    for (let j = i + 1; j < pricePeaks.length; j++) {
      const p1 = pricePeaks[i];
      const p2 = pricePeaks[j];
      const o1 = nearestPivot(oscPeaks, p1.index);
      const o2 = nearestPivot(oscPeaks, p2.index);
      if (!o1 || !o2) continue;
      tryPair("regular_bearish", p1, p2, o1, o2, p2.price > p1.price, o2.value < o1.value);
    }
  }

  for (let i = 0; i < priceTroughs.length - 1; i++) {
    for (let j = i + 1; j < priceTroughs.length; j++) {
      const p1 = priceTroughs[i];
      const p2 = priceTroughs[j];
      const o1 = nearestPivot(oscTroughs, p1.index);
      const o2 = nearestPivot(oscTroughs, p2.index);
      if (!o1 || !o2) continue;
      tryPair("hidden_bullish", p1, p2, o1, o2, p2.price > p1.price, o2.value < o1.value);
    }
  }

  for (let i = 0; i < pricePeaks.length - 1; i++) {
    for (let j = i + 1; j < pricePeaks.length; j++) {
      const p1 = pricePeaks[i];
      const p2 = pricePeaks[j];
      const o1 = nearestPivot(oscPeaks, p1.index);
      const o2 = nearestPivot(oscPeaks, p2.index);
      if (!o1 || !o2) continue;
      tryPair("hidden_bearish", p1, p2, o1, o2, p2.price < p1.price, o2.value > o1.value);
    }
  }

  return signals;
}

/**
 * Detect regular + hidden divergences between price and RSI / MACD histogram.
 * Only confirmed pivots (full left+right window) are used — no forming signals in Phase 1.
 */
export function detectDivergences(
  bars: OhlcvBar[],
  opts: DetectDivergenceOptions = {},
): DivergenceSignal[] {
  const left = opts.pivotLeft ?? DEFAULTS.pivotLeft;
  const right = opts.pivotRight ?? DEFAULTS.pivotRight;
  const minBars = opts.minBarsBetween ?? DEFAULTS.minBarsBetween;
  const maxBars = opts.maxBarsBetween ?? DEFAULTS.maxBarsBetween;
  const lookback = opts.lookback ?? DEFAULTS.lookback;
  const oscillators = opts.oscillators ?? DEFAULTS.oscillators;
  const maxSignals = opts.maxSignals ?? DEFAULTS.maxSignals;
  const timeframe = opts.timeframe;

  if (bars.length < left + right + minBars + 20) return [];

  const n = bars.length;
  const from = Math.max(0, n - lookback);
  const to = n - 1;

  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const times = bars.map((b) => b.time);

  const priceHighSeries: (number | null)[] = highs.map((h) => h);
  const priceLowSeries: (number | null)[] = lows.map((l) => l);

  const pricePeaks = findPeaks(priceHighSeries, times, highs, left, right, from, to);
  const priceTroughs = findTroughs(priceLowSeries, times, lows, left, right, from, to);

  const all: DivergenceSignal[] = [];

  if (oscillators.includes("rsi")) {
    const rsiSeries = rsi(closes, 14);
    const oscPeaks = findPeaks(rsiSeries, times, closes, left, right, from, to);
    const oscTroughs = findTroughs(rsiSeries, times, closes, left, right, from, to);
    all.push(
      ...pairDivergences(pricePeaks, priceTroughs, oscPeaks, oscTroughs, "rsi", minBars, maxBars, timeframe),
    );
  }

  if (oscillators.includes("macd_hist")) {
    const macdFull = macd(closes, 12, 26, 9);
    const hist = macdFull.histogram;
    const oscPeaks = findPeaks(hist, times, closes, left, right, from, to);
    const oscTroughs = findTroughs(hist, times, closes, left, right, from, to);
    all.push(
      ...pairDivergences(pricePeaks, priceTroughs, oscPeaks, oscTroughs, "macd_hist", minBars, maxBars, timeframe),
    );
  }

  all.sort((a, b) => {
    const tb = b.pricePivots[1].time - a.pricePivots[1].time;
    if (tb !== 0) return tb;
    return b.confidence - a.confidence;
  });

  const seen = new Set<string>();
  const deduped: DivergenceSignal[] = [];
  for (const s of all) {
    const key = `${s.kind}|${s.oscillator}|${s.pricePivots[1].index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(s);
    if (deduped.length >= maxSignals) break;
  }

  return deduped;
}

/** Human-readable Vietnamese labels for UI / signals array. */
export const DIVERGENCE_KIND_VI: Record<DivergenceKind, string> = {
  regular_bullish: "Phân kỳ tăng cổ điển (đảo chiều lên)",
  regular_bearish: "Phân kỳ giảm cổ điển (đảo chiều xuống)",
  hidden_bullish: "Phân kỳ ẩn tăng (tiếp diễn uptrend)",
  hidden_bearish: "Phân kỳ ẩn giảm (tiếp diễn downtrend)",
};

export function divergenceSummaryLine(s: DivergenceSignal): string {
  const osc = s.oscillator === "rsi" ? "RSI" : s.oscillator === "macd_hist" ? "MACD hist" : s.oscillator;
  const tf = s.timeframe ? ` ${s.timeframe}` : "";
  return `${DIVERGENCE_KIND_VI[s.kind]} · ${osc}${tf} · class ${s.strength} · ${s.barsBetween} nến`;
}
