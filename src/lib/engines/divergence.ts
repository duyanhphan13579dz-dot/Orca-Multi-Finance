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
  maxBarsBetween: 4,
  lookback: 40,
  maxAgeBarsFromEnd: 3,
  oscillators: ["rsi", "macd_hist"] as DivergenceOscillator[],
  maxSignals: 6,
  minPriceMovePct: 0.0015,
} as const;

interface PivotPoint {
  index: number;
  value: number;
  price: number;
  time: number;
}

/** Strict fractal peak: value strictly greater than left+right neighbors. */
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

/** Strength from oscillator zone + magnitude of oscillator recovery/deterioration. */
function strengthFor(
  kind: DivergenceKind,
  osc: DivergenceOscillator,
  firstOsc: number,
  secondOsc: number,
): DivergenceStrength {
  const delta = secondOsc - firstOsc;
  if (osc === "rsi" || osc === "stoch") {
    const extreme =
      kind === "regular_bullish" || kind === "hidden_bullish"
        ? firstOsc <= 30
        : firstOsc >= 70;
    const strongZone =
      kind === "regular_bullish" || kind === "hidden_bullish"
        ? firstOsc <= 40
        : firstOsc >= 60;
    const magOk = Math.abs(delta) >= 3;
    if (extreme && magOk) return "A";
    if (extreme || (strongZone && magOk)) return "B";
    if (strongZone) return "C";
    return "C";
  }
  // MACD hist / line: compare absolute levels and shrink ratio
  const mag1 = Math.abs(firstOsc);
  const mag2 = Math.abs(secondOsc);
  if (mag1 > 0 && mag2 < mag1 * 0.75 && mag1 >= mag2 * 1.4) return "A";
  if (mag1 > 0 && mag2 < mag1 * 0.9) return "B";
  return "C";
}

function confidenceFor(
  strength: DivergenceStrength,
  barsBetween: number,
  minBars: number,
  maxBars: number,
  structure: "single" | "double" | "triple",
  slopeScore: number,
): number {
  let c = strength === "A" ? 0.84 : strength === "B" ? 0.64 : 0.44;
  const span = Math.max(maxBars - minBars, 1);
  const mid = (minBars + maxBars) / 2;
  const dist = Math.abs(barsBetween - mid) / span;
  c -= dist * 0.1;
  // slopeScore 0..1 from magnitude quality
  c += slopeScore * 0.1;
  if (structure === "double") c = Math.min(0.96, c + 0.07);
  if (structure === "triple") c = Math.min(0.96, c + 0.11);
  return Math.max(0.12, Math.min(0.96, Math.round(c * 100) / 100));
}

/**
 * Find oscillator pivot nearest to price pivot index.
 * Osc list is sorted by index — binary-ish linear is fine (few pivots).
 */
function nearestPivot(pivots: PivotPoint[], index: number, maxDist = 3): PivotPoint | null {
  if (!pivots.length) return null;
  let best: PivotPoint | null = null;
  let bestDist = Infinity;
  for (const p of pivots) {
    const d = Math.abs(p.index - index);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    } else if (p.index > index + maxDist) {
      // pivots sorted ascending — can stop
      break;
    }
  }
  return bestDist <= maxDist ? best : null;
}

function smaVolume(volumes: number[], endIdx: number, n = 20): number {
  const start = Math.max(0, endIdx - n + 1);
  let sum = 0;
  let count = 0;
  for (let i = start; i <= endIdx; i++) {
    const v = volumes[i] ?? 0;
    if (v > 0) {
      sum += v;
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

function volumeAtPivot(
  volumes: number[],
  p1: PivotPoint,
  p2: PivotPoint,
  kind: DivergenceKind,
): { confirmed: boolean; ratio: number | null } {
  const v1 = volumes[p1.index] ?? 0;
  const v2 = volumes[p2.index] ?? 0;
  const avg = smaVolume(volumes, p2.index, 20);
  if (!(v2 > 0) && !(avg > 0)) return { confirmed: false, ratio: null };
  const ratio = avg > 0 ? v2 / avg : null;
  const elevated = ratio != null ? ratio >= 1.15 : v2 > 0;
  const mildElevated = ratio != null ? ratio >= 1.0 : v2 > 0;

  if (kind === "regular_bullish") {
    const exhaustion = v1 > 0 && v2 > 0 && v2 <= v1 * 0.9;
    return { confirmed: exhaustion || elevated, ratio };
  }
  if (kind === "regular_bearish") {
    return {
      confirmed: elevated || (mildElevated && v1 > 0 && v2 >= v1 * 0.95),
      ratio,
    };
  }
  // hidden: lighter volume on pullback preferred
  const light = v1 > 0 && v2 > 0 && v2 <= v1 * 1.05;
  return { confirmed: light || mildElevated, ratio };
}

/** Min oscillator delta so tiny noise is not labeled divergence. */
function minOscDelta(osc: DivergenceOscillator): number {
  if (osc === "rsi" || osc === "stoch") return 2.5;
  return 0; // MACD scale varies — rely on price gate + relative check
}

/**
 * Slope quality 0..1: stronger when |Δosc| is meaningful relative to |Δprice%|.
 */
function slopeScore(
  osc: DivergenceOscillator,
  priceDeltaPct: number,
  o1: number,
  o2: number,
): number {
  const absPrice = Math.abs(priceDeltaPct);
  const absOsc = Math.abs(o2 - o1);
  if (absPrice < 1e-9) return 0.3;
  if (osc === "rsi" || osc === "stoch") {
    // ~5 RSI pts per 1% price is strong disagreement
    const ratio = absOsc / (absPrice * 100);
    return Math.max(0, Math.min(1, ratio / 5));
  }
  // MACD: any clear directional osc move scores mid+
  return absOsc > 0 ? 0.55 : 0.2;
}

type PairCond = {
  kind: DivergenceKind;
  priceOk: (p1: PivotPoint, p2: PivotPoint) => boolean;
  oscOk: (o1: PivotPoint, o2: PivotPoint) => boolean;
  priceList: PivotPoint[];
  oscList: PivotPoint[];
};

/**
 * Pair **consecutive** pivots only — O(n) and matches standard chart analysis
 * (compare last trough to previous trough, not every historical pair).
 */
function pairDivergences(
  pricePeaks: PivotPoint[],
  priceTroughs: PivotPoint[],
  oscPeaks: PivotPoint[],
  oscTroughs: PivotPoint[],
  osc: DivergenceOscillator,
  minBars: number,
  maxBars: number,
  timeframe: string | undefined,
  volumes: number[],
  minPriceMovePct: number,
): DivergenceSignal[] {
  const signals: DivergenceSignal[] = [];
  const oscMin = minOscDelta(osc);

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
    if (prices.length < 2) continue;

    // Track which consecutive pairs diverged for structure detection
    const pairHit: boolean[] = new Array(prices.length - 1).fill(false);

    for (let i = 0; i < prices.length - 1; i++) {
      const p1 = prices[i]!;
      const p2 = prices[i + 1]!;
      const barsBetween = p2.index - p1.index;
      if (barsBetween < minBars || barsBetween > maxBars) continue;

      const base = Math.abs(p1.price) > 1e-12 ? Math.abs(p1.price) : 1;
      const priceDeltaPct = (p2.price - p1.price) / base;
      if (Math.abs(priceDeltaPct) < minPriceMovePct) continue;

      if (!cond.priceOk(p1, p2)) continue;

      const o1 = nearestPivot(cond.oscList, p1.index);
      const o2 = nearestPivot(cond.oscList, p2.index);
      if (!o1 || !o2) continue;
      if (Math.abs(o1.index - p1.index) > 3 || Math.abs(o2.index - p2.index) > 3) continue;
      if (!cond.oscOk(o1, o2)) continue;

      if (oscMin > 0 && Math.abs(o2.value - o1.value) < oscMin) continue;

      pairHit[i] = true;

      // Structure: consecutive adjacent divergences of same kind
      let legs = 1;
      if (i > 0 && pairHit[i - 1]) legs = 2;
      if (i > 1 && pairHit[i - 1] && pairHit[i - 2]) legs = 3;
      const structure: "single" | "double" | "triple" =
        legs >= 3 ? "triple" : legs >= 2 ? "double" : "single";

      const strength = strengthFor(cond.kind, osc, o1.value, o2.value);
      const slope = slopeScore(osc, priceDeltaPct, o1.value, o2.value);
      let confidence = confidenceFor(strength, barsBetween, minBars, maxBars, structure, slope);
      const vol = volumeAtPivot(volumes, p1, p2, cond.kind);
      if (vol.confirmed) confidence = Math.min(0.96, confidence + 0.07);
      else if (vol.ratio != null && vol.ratio < 0.7) confidence = Math.max(0.12, confidence - 0.05);

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
        volumeConfirmed: vol.confirmed,
        volumeRatio: vol.ratio != null ? Math.round(vol.ratio * 100) / 100 : null,
      });
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

  // Prefer recent, higher structure, volume-confirmed, then confidence
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

  const seen = new Set<string>();
  const deduped: DivergenceSignal[] = [];
  for (const s of filtered) {
    // Dedup by kind + later pivot (keep best osc per kind at same swing)
    const key = `${s.kind}|${s.pricePivots[1]!.index}`;
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
    s.structure === "double" ? " · kép" : s.structure === "triple" ? " · ba đỉnh/đáy" : "";
  const vol =
    s.volumeConfirmed === true ? " · vol✓" : s.volumeConfirmed === false ? " · vol✗" : "";
  return `${DIVERGENCE_KIND_VI[s.kind]} · ${osc}${tf}${struct} · hạng ${s.strength} · ${s.barsBetween} nến${vol}`;
}
