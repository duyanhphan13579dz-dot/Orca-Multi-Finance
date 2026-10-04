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

function isLocalExtreme(
  series: (number | null)[],
  i: number,
  left: number,
  right: number,
  mode: "peak" | "trough",
): boolean {
  const v = series[i];
  if (v == null || !Number.isFinite(v)) return false;
  for (let j = i - left; j <= i + right; j++) {
    if (j === i) continue;
    const o = series[j];
    if (o == null || !Number.isFinite(o)) continue;
    if (mode === "peak" && o > v) return false;
    if (mode === "trough" && o < v) return false;
  }
  return true;
}

function findPivots(
  series: (number | null)[],
  times: number[],
  prices: number[],
  left: number,
  right: number,
  from: number,
  to: number,
  mode: "peak" | "trough",
): DivergencePivot[] {
  const out: DivergencePivot[] = [];
  for (let i = Math.max(from + left, left); i <= to - right; i++) {
    if (!isLocalExtreme(series, i, left, right, mode)) continue;
    const v = series[i]!;
    out.push({ index: i, time: times[i]!, value: v, price: prices[i]! });
  }
  return out;
}

function oscMinMove(osc: DivergenceOscillator): number {
  if (osc === "rsi" || osc === "stoch") return 2.5;
  if (osc === "macd_hist") return 0.0;
  return 0.0;
}

function pairAdjacent(
  pricePivots: DivergencePivot[],
  oscPivots: DivergencePivot[],
  kind: DivergenceKind,
  osc: DivergenceOscillator,
  minBars: number,
  maxBars: number,
  minPriceMovePct: number,
  volumes: number[],
  timeframe?: string,
): DivergenceSignal[] {
  const signals: DivergenceSignal[] = [];
  const tol = osc === "rsi" || osc === "stoch" ? 2 : 3;

  for (let i = 1; i < pricePivots.length; i++) {
    const a = pricePivots[i - 1]!;
    const b = pricePivots[i]!;
    const gap = b.index - a.index;
    if (gap < minBars || gap > maxBars) continue;

    const priceMove = Math.abs(b.price - a.price) / Math.max(Math.abs(a.price), 1e-9);
    if (priceMove < minPriceMovePct) continue;

    // Match oscillator pivots near price pivots
    const findNear = (p: DivergencePivot) => {
      let best: DivergencePivot | null = null;
      let bestD = tol + 1;
      for (const op of oscPivots) {
        const d = Math.abs(op.index - p.index);
        if (d <= tol && d < bestD) {
          best = op;
          bestD = d;
        }
      }
      return best;
    };
    const oa = findNear(a);
    const ob = findNear(b);
    if (!oa || !ob) continue;

    const minOsc = oscMinMove(osc);
    if (Math.abs(ob.value - oa.value) < minOsc && minOsc > 0) continue;

    const bullish = kind.includes("bullish");
    const regular = kind.startsWith("regular");

    // Validate divergence geometry
    if (regular && bullish) {
      // LL price, HL osc
      if (!(b.price < a.price && ob.value > oa.value)) continue;
    } else if (regular && !bullish) {
      // HH price, LH osc
      if (!(b.price > a.price && ob.value < oa.value)) continue;
    } else if (!regular && bullish) {
      // HL price, LL osc (hidden bullish)
      if (!(b.price > a.price && ob.value < oa.value)) continue;
    } else {
      // LH price, HH osc (hidden bearish)
      if (!(b.price < a.price && ob.value > oa.value)) continue;
    }

    const priceDeltaPct = ((b.price - a.price) / Math.max(Math.abs(a.price), 1e-9)) * 100;
    const oscDelta = ob.value - oa.value;
    const slopeBoost = Math.min(20, Math.abs(oscDelta) * (osc === "rsi" || osc === "stoch" ? 0.8 : 5));
    let confidence = 0.45 + Math.min(0.25, Math.abs(priceDeltaPct) / 8) + slopeBoost / 100;

    const volA = volumes[a.index] ?? 0;
    const volB = volumes[b.index] ?? 0;
    let volumeConfirmed: boolean | null = null;
    if (volA > 0 && volB > 0) {
      volumeConfirmed = volB >= volA * 0.9;
      if (volumeConfirmed) confidence += 0.06;
    }
    confidence = Math.max(0.2, Math.min(0.95, confidence));

    const strength: DivergenceStrength =
      confidence >= 0.72 ? "strong" : confidence >= 0.55 ? "moderate" : "weak";

    signals.push({
      kind,
      oscillator: osc,
      strength,
      confidence,
      barsBetween: gap,
      timeframe: timeframe ?? null,
      pricePivots: [a, b],
      oscPivots: [oa, ob],
      structure: "double",
      volumeConfirmed,
      detectedAt: b.time,
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

  const pricePeaks = findPivots(highs, times, highs, left, right, from, to, "peak");
  const priceTroughs = findPivots(lows, times, lows, left, right, from, to, "trough");

  const all: DivergenceSignal[] = [];

  const pushOsc = (osc: DivergenceOscillator, series: (number | null)[]) => {
    const oscPeaks = findPivots(series, times, closes, left, right, from, to, "peak");
    const oscTroughs = findPivots(series, times, closes, left, right, from, to, "trough");

    all.push(
      ...pairAdjacent(
        pricePeaks,
        oscPeaks,
        "regular_bearish",
        osc,
        minBars,
        maxBars,
        minPriceMovePct,
        volumes,
        timeframe,
      ),
      ...pairAdjacent(
        priceTroughs,
        oscTroughs,
        "regular_bullish",
        osc,
        minBars,
        maxBars,
        minPriceMovePct,
        volumes,
        timeframe,
      ),
      ...pairAdjacent(
        pricePeaks,
        oscPeaks,
        "hidden_bearish",
        osc,
        minBars,
        maxBars,
        minPriceMovePct,
        volumes,
        timeframe,
      ),
      ...pairAdjacent(
        priceTroughs,
        oscTroughs,
        "hidden_bullish",
        osc,
        minBars,
        maxBars,
        minPriceMovePct,
        volumes,
        timeframe,
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

export type DivergenceConfluence = {
  kind: DivergenceKind;
  timeframes: string[];
  oscillators: DivergenceOscillator[];
  bestConfidence: number;
  signals: DivergenceSignal[];
  strength: DivergenceStrength;
};

export function buildDivergenceConfluence(
  byTf: { timeframe: string; signals: DivergenceSignal[] }[],
): DivergenceConfluence[] {
  const map = new Map<string, DivergenceConfluence>();
  for (const { timeframe, signals } of byTf) {
    for (const s of signals) {
      const key = s.kind;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          kind: s.kind,
          timeframes: [timeframe],
          oscillators: [s.oscillator],
          bestConfidence: s.confidence,
          signals: [s],
          strength: s.strength,
        });
        continue;
      }
      if (!existing.timeframes.includes(timeframe)) existing.timeframes.push(timeframe);
      if (!existing.oscillators.includes(s.oscillator)) existing.oscillators.push(s.oscillator);
      existing.signals.push(s);
      if (s.confidence > existing.bestConfidence) {
        existing.bestConfidence = s.confidence;
        existing.strength = s.strength;
      }
    }
  }
  return [...map.values()]
    .filter((c) => c.timeframes.length >= 2)
    .sort((a, b) => b.bestConfidence - a.bestConfidence || b.timeframes.length - a.timeframes.length);
}

export const DIVERGENCE_KIND_VI: Record<DivergenceKind, string> = {
  regular_bullish: "Phân kỳ tăng cổ điển (đảo chiều lên)",
  regular_bearish: "Phân kỳ giảm cổ điển (đảo chiều xuống)",
  hidden_bullish: "Phân kỳ ẩn tăng (tiếp diễn lên)",
  hidden_bearish: "Phân kỳ ẩn giảm (tiếp diễn xuống)",
};

const OSC_LABEL: Record<DivergenceOscillator, string> = {
  rsi: "RSI",
  macd_hist: "MACD hist",
  macd_line: "MACD line",
  stoch: "Stoch",
};

export function divergenceSummaryLine(s: DivergenceSignal): string {
  const osc = OSC_LABEL[s.oscillator] ?? s.oscillator;
  const tf = s.timeframe ? ` · ${s.timeframe}` : "";
  const struct = s.structure && s.structure !== "double" ? ` · ${s.structure}` : "";
  const vol =
    s.volumeConfirmed === true ? " · vol✓" : s.volumeConfirmed === false ? " · vol✗" : "";
  return `${DIVERGENCE_KIND_VI[s.kind]} · ${osc}${tf}${struct} · class ${s.strength} · hạng ${s.strength} · ${s.barsBetween} nến${vol}`;
}
