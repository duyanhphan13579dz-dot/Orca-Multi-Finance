/**
 * DIVERGENCE ENGINE — deterministic regular + hidden divergence detection.
 *
 * Phase 0–1: RSI + MACD hist, confirmed pivots, Class A/B/C
 * Phase 5: + MACD line, Stochastic; double/triple structure on successive pivots
 * Quant-only: pivots on closed bars, no LLM. Callers attach freshness/meta.
 *
 * Short window (3–4 phiên D1):
 *   preset SHORT_3_4D — pivot nhỏ, maxBarsBetween≤4, last pivot gần nến cuối.
 */

import type { OhlcvBar } from "../types";
import type {
  DivergenceKind,
  DivergenceOscillator,
  DivergenceSignal,
  DivergenceStrength,
  DivergencePivot,
} from "../types";
import { rsi, macd, stochastic } from "../technical";

export interface DetectDivergenceOptions {
  pivotLeft?: number;
  pivotRight?: number;
  minBarsBetween?: number;
  maxBarsBetween?: number;
  lookback?: number;
  timeframe?: string;
  oscillators?: DivergenceOscillator[];
  maxSignals?: number;
  /**
   * Only keep signals whose *later* price pivot is within N bars of series end.
   * Use 3–4 for "phân kỳ giai đoạn 3–4 ngày gần nhất" on daily charts.
   */
  maxAgeBarsFromEnd?: number;
  /** Apply SHORT_3_4D pivot geometry (overrides left/right/min/max/lookback if unset). */
  window?: "default" | "short_3_4d";
}

const DEFAULTS = {
  pivotLeft: 5,
  pivotRight: 5,
  minBarsBetween: 5,
  maxBarsBetween: 60,
  lookback: 120,
  oscillators: ["rsi", "macd_hist", "macd_line", "stoch"] as DivergenceOscillator[],
  maxSignals: 8,
};

/** Geometry tuned for 3–4 daily bars between pivots (swing ngắn). */
export const SHORT_3_4D = {
  pivotLeft: 2,
  pivotRight: 1,
  minBarsBetween: 2,
  maxBarsBetween: 4,
  lookback: 40,
  maxAgeBarsFromEnd: 3,
  oscillators: ["rsi", "macd_hist"] as DivergenceOscillator[],
  maxSignals: 6,
} as const;

interface PivotPoint {
  index: number;
  value: number;
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
    if (isPeak) out.push({ index: i, value: v, price: prices[i]!, time: times[i]! });
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
    if (isTrough) out.push({ index: i, value: v, price: prices[i]!, time: times[i]! });
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
  if (osc === "rsi" || osc === "stoch") {
    if (kind === "regular_bullish" || kind === "hidden_bullish") {
      if (firstOsc <= 20) return "A";
      if (firstOsc <= 30) return "A";
      if (firstOsc <= 40) return "B";
      return "C";
    }
    if (firstOsc >= 80) return "A";
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
  structure: "single" | "double" | "triple",
): number {
  let c = strength === "A" ? 0.82 : strength === "B" ? 0.62 : 0.42;
  const mid = (minBars + maxBars) / 2;
  const dist = Math.abs(barsBetween - mid) / Math.max(maxBars - minBars, 1);
  c -= dist * 0.12;
  if (structure === "double") c = Math.min(0.95, c + 0.08);
  if (structure === "triple") c = Math.min(0.95, c + 0.12);
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

type PairCond = {
  kind: DivergenceKind;
  priceOk: (p1: PivotPoint, p2: PivotPoint) => boolean;
  oscOk: (o1: PivotPoint, o2: PivotPoint) => boolean;
  priceList: PivotPoint[];
  oscList: PivotPoint[];
};

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
  const conditions: PairCond[] = [
    {
      kind: "regular_bullish",
      priceList: priceTroughs,
      oscList: oscTroughs,
      priceOk: (a, b) => b.price < a.price,
      oscOk: (a, b) => b.value > a.value,
    },
    {
      kind: "regular_bearish",
      priceList: pricePeaks,
      oscList: oscPeaks,
      priceOk: (a, b) => b.price > a.price,
      oscOk: (a, b) => b.value < a.value,
    },
    {
      kind: "hidden_bullish",
      priceList: priceTroughs,
      oscList: oscTroughs,
      priceOk: (a, b) => b.price > a.price,
      oscOk: (a, b) => b.value < a.value,
    },
    {
      kind: "hidden_bearish",
      priceList: pricePeaks,
      oscList: oscPeaks,
      priceOk: (a, b) => b.price < a.price,
      oscOk: (a, b) => b.value > a.value,
    },
  ];

  for (const cond of conditions) {
    const prices = cond.priceList;
    for (let i = 0; i < prices.length - 1; i++) {
      for (let j = i + 1; j < prices.length; j++) {
        const p1 = prices[i]!;
        const p2 = prices[j]!;
        const barsBetween = p2.index - p1.index;
        if (barsBetween < minBars || barsBetween > maxBars) continue;
        const o1 = nearestPivot(cond.oscList, p1.index);
        const o2 = nearestPivot(cond.oscList, p2.index);
        if (!o1 || !o2) continue;
        if (Math.abs(o1.index - p1.index) > 3 || Math.abs(o2.index - p2.index) > 3) continue;
        if (!cond.priceOk(p1, p2) || !cond.oscOk(o1, o2)) continue;

        let legs = 1;
        for (let m = i + 1; m < j; m++) {
          const pm = prices[m]!;
          const om = nearestPivot(cond.oscList, pm.index);
          if (!om) continue;
          const leg1 =
            cond.priceOk(p1, pm) &&
            cond.oscOk(o1, om) &&
            pm.index - p1.index >= minBars &&
            pm.index - p1.index <= maxBars;
          const leg2 =
            cond.priceOk(pm, p2) &&
            cond.oscOk(om, o2) &&
            p2.index - pm.index >= minBars &&
            p2.index - pm.index <= maxBars;
          if (leg1 && leg2) legs++;
        }
        const structure: "single" | "double" | "triple" =
          legs >= 3 ? "triple" : legs >= 2 ? "double" : "single";

        const strength = strengthFor(cond.kind, osc, o1.value, o2.value);
        const confidence = confidenceFor(strength, barsBetween, minBars, maxBars, structure);

        signals.push({
          kind: cond.kind,
          oscillator: osc,
          timeframe: timeframe ?? null,
          strength,
          confidence,
          barsBetween,
          pricePivots: [toPivot(p1, true), toPivot(p2, true)],
          oscPivots: [toPivot(o1, false), toPivot(o2, false)],
          structure,
          confirmed: true,
          confirmedAt: new Date(p2.time).toISOString(),
          forming: false,
        });
      }
    }
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
      ),
    );
  };

  if (oscillators.includes("rsi")) {
    pushOsc("rsi", rsi(closes, 14));
  }
  if (oscillators.includes("macd_hist") || oscillators.includes("macd_line")) {
    const macdFull = macd(closes, 12, 26, 9);
    if (oscillators.includes("macd_hist")) pushOsc("macd_hist", macdFull.histogram);
    if (oscillators.includes("macd_line")) pushOsc("macd_line", macdFull.macd);
  }
  if (oscillators.includes("stoch")) {
    pushOsc("stoch", stochastic(highs, lows, closes, 14, 3));
  }

  // Keep only divergences whose second pivot is in the last N bars (fresh swing)
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
    return b.confidence - a.confidence;
  });

  const seen = new Set<string>();
  const deduped: DivergenceSignal[] = [];
  for (const s of filtered) {
    const key = `${s.kind}|${s.oscillator}|${s.pricePivots[1]!.index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(s);
    if (deduped.length >= maxSignals) break;
  }

  return deduped;
}

export type DivergenceConfluence = {
  kind: DivergenceKind;
  timeframes: string[];
  signals: DivergenceSignal[];
  confidence: number;
  strength: DivergenceStrength;
};

export function buildDivergenceConfluence(
  byTf: { timeframe: string; signals: DivergenceSignal[] }[],
): DivergenceConfluence[] {
  const map = new Map<string, DivergenceConfluence>();
  for (const leg of byTf) {
    for (const s of leg.signals) {
      const key = s.kind;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          kind: s.kind,
          timeframes: [leg.timeframe],
          signals: [{ ...s, timeframe: leg.timeframe }],
          confidence: s.confidence,
          strength: s.strength,
        });
      } else {
        if (!existing.timeframes.includes(leg.timeframe)) {
          existing.timeframes.push(leg.timeframe);
        }
        existing.signals.push({ ...s, timeframe: leg.timeframe });
        if (s.confidence > existing.confidence) existing.confidence = s.confidence;
        const rank = { A: 3, B: 2, C: 1 };
        if (rank[s.strength] > rank[existing.strength]) existing.strength = s.strength;
      }
    }
  }
  return [...map.values()]
    .filter((c) => c.timeframes.length >= 2)
    .sort((a, b) => b.confidence - a.confidence || b.timeframes.length - a.timeframes.length);
}

export const DIVERGENCE_KIND_VI: Record<DivergenceKind, string> = {
  regular_bullish: "Phân kỳ tăng cổ điển (đảo chiều lên)",
  regular_bearish: "Phân kỳ giảm cổ điển (đảo chiều xuống)",
  hidden_bullish: "Phân kỳ ẩn tăng (tiếp diễn uptrend)",
  hidden_bearish: "Phân kỳ ẩn giảm (tiếp diễn downtrend)",
};

const OSC_LABEL: Record<DivergenceOscillator, string> = {
  rsi: "RSI",
  macd_hist: "MACD hist",
  macd_line: "MACD line",
  stoch: "Stoch",
};

export function divergenceSummaryLine(s: DivergenceSignal): string {
  const osc = OSC_LABEL[s.oscillator] ?? s.oscillator;
  const tf = s.timeframe ? ` ${s.timeframe}` : "";
  const struct =
    s.structure === "double" ? " · double" : s.structure === "triple" ? " · triple" : "";
  return `${DIVERGENCE_KIND_VI[s.kind]} · ${osc}${tf}${struct} · class ${s.strength} · ${s.barsBetween} nến`;
}
