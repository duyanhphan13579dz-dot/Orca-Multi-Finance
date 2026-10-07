/**
 * Pure oscillator / moving-average helpers — no dependency on technical.ts
 * or divergence engine (breaks Turbopack circular import).
 */

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period + 1) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) avgGain += d;
    else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): { macd: (number | null)[]; signal: (number | null)[]; histogram: (number | null)[] } {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine: (number | null)[] = values.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null
      ? (emaFast[i] as number) - (emaSlow[i] as number)
      : null,
  );
  const macdVals = macdLine.map((v) => v ?? 0);
  const firstValid = macdLine.findIndex((v) => v != null);
  const signalFull = ema(macdVals.slice(Math.max(0, firstValid)), signalPeriod);
  const signal: (number | null)[] = new Array(values.length).fill(null);
  for (let i = 0; i < signalFull.length; i++) {
    signal[i + Math.max(0, firstValid)] = signalFull[i];
  }
  const histogram = macdLine.map((m, i) =>
    m != null && signal[i] != null ? m - (signal[i] as number) : null,
  );
  return { macd: macdLine, signal, histogram };
}

/**
 * Stochastic oscillator.
 * Returns smoothed %K (SMA of raw %K over dPeriod) for pivot detection.
 */
export function stochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  kPeriod = 14,
  dPeriod = 3,
): (number | null)[] {
  const n = closes.length;
  const rawK: (number | null)[] = new Array(n).fill(null);
  if (kPeriod <= 0 || n < kPeriod) return rawK;

  for (let i = kPeriod - 1; i < n; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (highs[j] > hi) hi = highs[j];
      if (lows[j] < lo) lo = lows[j];
    }
    const range = hi - lo;
    rawK[i] = range === 0 ? 50 : ((closes[i] - lo) / range) * 100;
  }

  if (dPeriod <= 1) return rawK;

  const out: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (rawK[i] == null) continue;
    if (i < kPeriod - 1 + dPeriod - 1) continue;
    let sum = 0;
    let count = 0;
    for (let j = i - dPeriod + 1; j <= i; j++) {
      if (rawK[j] != null) {
        sum += rawK[j] as number;
        count++;
      }
    }
    if (count === dPeriod) out[i] = sum / dPeriod;
  }
  return out;
}
