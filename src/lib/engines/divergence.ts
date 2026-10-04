/**
 * DIVERGENCE ENGINE — deterministic regular + hidden divergence detection.
 *
 * Optimizations (v2):
 * - Pair **adjacent** same-type pivots only (classic TA, O(n) not O(n²))
 * - Min price / oscillator magnitude gates → fewer false positives
 * - Slope-aware confidence (Δosc vs Δprice)
 * - Volume confirmation at newer pivot
 * - Short window SHORT_3_4D for 3–4 session swings
 */

import type { OhlcvBar } from "../types";
import type {
  DivergenceKind,
  DivergenceOscillator,
  DivergenceSignal,
  DivergenceStrength,
  DivergencePivot,
} from "../types";
import { rsi, macd, stochastic } from "./oscillators";

export interface DetectDivergenceOptions {
  pivotLeft?: number;
  pivotRight?: number;
  minBarsBetween?: number;
  maxBarsBetween?: number;
  lookback?: number;
  timeframe?: string;
  oscillators?: DivergenceOscillator[];
  maxSignals?: number;
  maxAgeBarsFromEnd?: number;
  window?: "default" | "short_3_4d";
  /** Min relative price move between pivots (default 0.15% short / 0.35% full). */
  minPriceMovePct?: number;
}

const DEFAULTS = {
  pivotLeft: 5,
  pivotRight: 5,
  minBarsBetween: 5,
  maxBarsBetween: 60,
  lookback: 120,
  oscillators: ["rsi", "macd_hist", "macd_line", "stoch"] as DivergenceOscillator[],
  maxSignals: 8,
  minPriceMovePct: 0.0035,
};

export const SHORT_3_4D = {
  pivotLeft: 2,
  pivotRight: 1,
  minBarsBetween: 2,
  maxBarsBetween: 12,
  lookback: 28,
  oscillators: ["rsi", "macd_hist"] as DivergenceOscillator[],
  maxSignals: 5,
  maxAgeBarsFromEnd: 8,
  minPriceMovePct: 0.0015,
};

function isFiniteNum(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v);
}

function findPeaks(
  series: (number | null)[],
  times: number[],
  priceRef: number[],
  left: number,
  right: number,
  from: number,
  to: number,
): DivergencePivot[] {
  const out: DivergencePivot[] = [];
  for (let i = Math.max(from + left, left); i <= to - right; i++) {
    const v = series[i];
    if (!isFiniteNum(v)) continue;
    let isPeak = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      const o = series[j];
      if (!isFiniteNum(o) || o > v) {
        isPeak = false;
        break;
      }
    }
    if (isPeak) {
      out.push({ index: i, time: times[i]!, value: v, price: priceRef[i]! });
    }
  }
  return out;
}

function findTroughs(
  series: (number | null)[],
  times: number[],
  priceRef: number[],
  left: number,
  right: number,
  from: number,
  to: number,
): DivergencePivot[] {
  const out: DivergencePivot[] = [];
  for (let i = Math.max(from + left, left); i <= to - right; i++) {
    const v = series[i];
    if (!isFiniteNum(v)) continue;
    let isTrough = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      const o = series[j];
      if (!isFiniteNum(o) || o < v) {
        isTrough = false;
        break;
      }
    }
    if (isTrough) {
      out.push({ index: i, time: times[i]!, value: v, price: priceRef[i]! });
    }
  }
  return out;
}

function pairDivergences(
  pricePeaks: DivergencePivot[],
  priceTroughs: DivergencePivot[],
  oscPeaks: DivergencePivot[],
  oscTroughs: DivergencePivot[],
  osc: DivergenceOscillator,
  minBars: number,
  maxBars: number,
  timeframe: string | undefined,
  volumes: number[],
  minPriceMovePct: number,
): DivergenceSignal[] {
  const signals: DivergenceSignal[] = [];

  const matchPivot = (
    pricePivot: DivergencePivot,
    oscList: DivergencePivot[],
    tol: number,
  ): DivergencePivot | null => {
    let best: DivergencePivot | null = null;
    let bestDist = tol + 1;
    for (const op of oscList) {
      const d = Math.abs(op.index - pricePivot.index);
      if (d <= tol && d < bestDist) {
        best = op;
        bestDist = d;
      }
    }
    return best;
  };

  const tol = 2;

  // Bearish regular: higher high price, lower high oscillator
  for (let i = 1; i < pricePeaks.length; i++) {
    const p0 = pricePeaks[i - 1]!;
    const p1 = pricePeaks[i]!;
    const barsBetween = p1.index - p0.index;
    if (barsBetween < minBars || barsBetween > maxBars) continue;
    const priceMove = (p1.price - p0.price) / Math.max(Math.abs(p0.price), 1e-9);
    if (priceMove < minPriceMovePct) continue;
    if (!(p1.price > p0.price)) continue;

    const o0 = matchPivot(p0, oscPeaks, tol);
    const o1 = matchPivot(p1, oscPeaks, tol);
    if (!o0 || !o1) continue;
    if (!(o1.value < o0.value)) continue;

    const oscDelta = o0.value - o1.value;
    const conf = Math.min(
      95,
      45 + Math.min(25, priceMove * 1000) + Math.min(25, Math.abs(oscDelta) * 2),
    );
    const vol1 = volumes[p1.index] ?? 0;
    const vol0 = volumes[p0.index] ?? 0;
    const volumeConfirmed = vol0 > 0 ? vol1 >= vol0 * 0.85 : null;

    signals.push({
      kind: "regular_bearish",
      oscillator: osc,
      strength: conf >= 70 ? "strong" : conf >= 55 ? "moderate" : "weak",
      confidence: Math.round(conf),
      timeframe: timeframe ?? null,
      pricePivots: [p0, p1],
      oscPivots: [o0, o1],
      structure: "double",
      volumeConfirmed,
      summary: `Regular bearish ${osc}: HH price vs LH osc`,
    } as DivergenceSignal);
  }

  // Bullish regular: lower low price, higher low oscillator
  for (let i = 1; i < priceTroughs.length; i++) {
    const p0 = priceTroughs[i - 1]!;
    const p1 = priceTroughs[i]!;
    const barsBetween = p1.index - p0.index;
    if (barsBetween < minBars || barsBetween > maxBars) continue;
    const priceMove = (p0.price - p1.price) / Math.max(Math.abs(p0.price), 1e-9);
    if (priceMove < minPriceMovePct) continue;
    if (!(p1.price < p0.price)) continue;

    const o0 = matchPivot(p0, oscTroughs, tol);
    const o1 = matchPivot(p1, oscTroughs, tol);
    if (!o0 || !o1) continue;
    if (!(o1.value > o0.value)) continue;

    const oscDelta = o1.value - o0.value;
    const conf = Math.min(
      95,
      45 + Math.min(25, priceMove * 1000) + Math.min(25, Math.abs(oscDelta) * 2),
    );
    const vol1 = volumes[p1.index] ?? 0;
    const vol0 = volumes[p0.index] ?? 0;
    const volumeConfirmed = vol0 > 0 ? vol1 >= vol0 * 0.85 : null;

    signals.push({
      kind: "regular_bullish",
      oscillator: osc,
      strength: conf >= 70 ? "strong" : conf >= 55 ? "moderate" : "weak",
      confidence: Math.round(conf),
      timeframe: timeframe ?? null,
      pricePivots: [p0, p1],
      oscPivots: [o0, o1],
      structure: "double",
      volumeConfirmed,
      summary: `Regular bullish ${osc}: LL price vs HL osc`,
    } as DivergenceSignal);
  }

  // Hidden bearish: lower high price, higher high oscillator
  for (let i = 1; i < pricePeaks.length; i++) {
    const p0 = pricePeaks[i - 1]!;
    const p1 = pricePeaks[i]!;
    const barsBetween = p1.index - p0.index;
    if (barsBetween < minBars || barsBetween > maxBars) continue;
    if (!(p1.price < p0.price)) continue;
    const o0 = matchPivot(p0, oscPeaks, tol);
    const o1 = matchPivot(p1, oscPeaks, tol);
    if (!o0 || !o1) continue;
    if (!(o1.value > o0.value)) continue;
    const conf = 50;
    signals.push({
      kind: "hidden_bearish",
      oscillator: osc,
      strength: "moderate",
      confidence: conf,
      timeframe: timeframe ?? null,
      pricePivots: [p0, p1],
      oscPivots: [o0, o1],
      structure: "double",
      volumeConfirmed: null,
      summary: `Hidden bearish ${osc}: LH price vs HH osc`,
    } as DivergenceSignal);
  }

  // Hidden bullish: higher low price, lower low oscillator
  for (let i = 1; i < priceTroughs.length; i++) {
    const p0 = priceTroughs[i - 1]!;
    const p1 = priceTroughs[i]!;
    const barsBetween = p1.index - p0.index;
    if (barsBetween < minBars || barsBetween > maxBars) continue;
    if (!(p1.price > p0.price)) continue;
    const o0 = matchPivot(p0, oscTroughs, tol);
    const o1 = matchPivot(p1, oscTroughs, tol);
    if (!o0 || !o1) continue;
    if (!(o1.value < o0.value)) continue;
    const conf = 50;
    signals.push({
      kind: "hidden_bullish",
      oscillator: osc,
      strength: "moderate",
      confidence: conf,
      timeframe: timeframe ?? null,
      pricePivots: [p0, p1],
      oscPivots: [o0, o1],
      structure: "double",
      volumeConfirmed: null,
      summary: `Hidden bullish ${osc}: HL price vs LL osc`,
    } as DivergenceSignal);
  }

  return signals;
}

export function detectDivergences(
  bars: OhlcvBar[],
  opts: DetectDivergenceOptions = {},
): DivergenceSignal[] {
  const short = opts.window === "short_3_4d";
  const left = opts.pivotLeft ?? (short ? SHORT_3_4D.pivotLeft : DEFAULTS.pivotLeft);
  const right = opts.pivotRight ?? (short ? SHORT_3_4D.pivotRight : DEFAULTS.pivotRight);
  const minBars = opts.minBarsBetween ?? (short ? SHORT_3_4D.minBarsBetween : DEFAULTS.minBarsBetween);
  const maxBars = opts.maxBarsBetween ?? (short ? SHORT_3_4D.maxBarsBetween : DEFAULTS.maxBarsBetween);
  const lookback = opts.lookback ?? (short ? SHORT_3_4D.lookback : DEFAULTS.lookback);
  const oscillators =
    opts.oscillators ?? (short ? [...SHORT_3_4D.oscillators] : DEFAULTS.oscillators);
  const maxSignals = opts.maxSignals ?? (short ? SHORT_3_4D.maxSignals : DEFAULTS.maxSignals);
  const maxAge =
    opts.maxAgeBarsFromEnd ?? (short ? SHORT_3_4D.maxAgeBarsFromEnd : undefined);
  const minPriceMovePct =
    opts.minPriceMovePct ?? (short ? SHORT_3_4D.minPriceMovePct : DEFAULTS.minPriceMovePct);
  const timeframe = opts.timeframe;

  const minLen = left + right + minBars + (short ? 12 : 20);
  if (bars.length < minLen) return [];

  const n = bars.length;
  const from = Math.max(0, n - lookback);
  const to = n - 1;

  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const times = bars.map((b) => b.time);
  const volumes = bars.map((b) => b.volume ?? 0);

  const pricePeaks = findPeaks(highs, times, highs, left, right, from, to);
  const priceTroughs = findTroughs(lows, times, lows, left, right, from, to);

  const all: DivergenceSignal[] = [];

  const pushOsc = (osc: DivergenceOscillator, series: (number | null)[]) => {
    const oscPeaks = findPeaks(series, times, closes, left, right, from, to);
    const oscTroughs = findTroughs(series, times, closes, left, right, from, to);
    all.push(
      ...pairDivergences(
        pricePeaks,
        priceTroughs,
        oscPeaks,
        oscTroughs,
        osc,
        minBars,
        maxBars,
        timeframe,
        volumes,
        minPriceMovePct,
      ),
    );
  };

  if (oscillators.includes("rsi")) pushOsc("rsi", rsi(closes, 14));
  if (oscillators.includes("macd_hist") || oscillators.includes("macd_line")) {
    const macdFull = macd(closes, 12, 26, 9);
    if (oscillators.includes("macd_hist")) pushOsc("macd_hist", macdFull.histogram);
    if (oscillators.includes("macd_line")) pushOsc("macd_line", macdFull.macd);
  }
  if (oscillators.includes("stoch")) pushOsc("stoch", stochastic(highs, lows, closes, 14, 3));

  let filtered = all;
  if (maxAge != null && maxAge >= 0) {
    const minIdx = n - 1 - maxAge;
    filtered = all.filter((s) => s.pricePivots[1]!.index >= minIdx);
  }

  filtered.sort((a, b) => {
    const tb = b.pricePivots[1]!.time - a.pricePivots[1]!.time;
    if (tb !== 0) return tb;
    const sa = a.structure === "triple" ? 3 : a.structure === "double" ? 2 : 1;
    const sb = b.structure === "triple" ? 3 : b.structure === "double" ? 2 : 1;
    if (sb !== sa) return sb - sa;
    const va = a.volumeConfirmed === true ? 1 : 0;
    const vb = b.volumeConfirmed === true ? 1 : 0;
    if (vb !== va) return vb - va;
    return b.confidence - a.confidence;
  });

  return filtered.slice(0, maxSignals);
}

export function divergenceSummaryLine(d: DivergenceSignal): string {
  const dir =
    d.kind.includes("bullish") ? "bullish" : d.kind.includes("bearish") ? "bearish" : d.kind;
  const hid = d.kind.startsWith("hidden") ? "hidden " : "";
  return `${hid}${dir} divergence (${d.oscillator}, conf ${d.confidence}%)`;
}
