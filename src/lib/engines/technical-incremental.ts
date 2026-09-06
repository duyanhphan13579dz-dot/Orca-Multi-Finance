/**
 * INCREMENTAL TECHNICAL ENGINE — stateful indicator updates O(1) per tick
 * (amortized) instead of re-scanning the whole series.
 *
 * Deterministically replicates `src/lib/technical.ts` semantics:
 *   SMA sliding window · EMA SMA-seeded · Wilder RSI · MACD(12,26,9) with
 *   signal EMA over the macd line · Bollinger population σ · ATR simple
 *   last-N TR average.
 *
 * Usage: seed(historyBars) → update(bar) per live candle → snapshot().
 * Full recompute (`analyzeSeries`) remains available for history endpoints;
 * this engine only serves live/streaming paths so a tick costs microseconds.
 */

import type { OhlcvBar } from "../types";

export interface IncrementalSnapshot {
  last: number;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema12: number | null;
  ema26: number | null;
  rsi14: number | null;
  macd: { macd: number; signal: number; histogram: number } | null;
  bollinger: { upper: number; mid: number; lower: number } | null;
  atr14: number | null;
  count: number;
}

interface EmaState {
  period: number;
  k: number;
  seedSum: number;
  seedCount: number;
  value: number | null;
}

interface AtrState {
  trs: { tr: number; high: number; low: number; close: number }[];
  sum: number;
}

function makeEma(period: number): EmaState {
  return { period, k: 2 / (period + 1), seedSum: 0, seedCount: 0, value: null };
}

/** Push one value through the EMA state machine (matches technical.ema). */
function emaPush(st: EmaState, v: number): number | null {
  if (st.value == null) {
    st.seedSum += v;
    st.seedCount += 1;
    if (st.seedCount === st.period) {
      st.value = st.seedSum / st.period;
      return st.value;
    }
    return null;
  }
  st.value = v * st.k + st.value * (1 - st.k);
  return st.value;
}

export class IncrementalIndicators {
  private closes: number[] = [];
  private highs: number[] = [];
  private lows: number[] = [];
  private ema12 = makeEma(12);
  private ema26 = makeEma(26);
  private macdLine: number[] = [];
  private macdSignal = makeEma(9);
  private lastMacd: number | null = null;
  private lastSignal: number | null = null;
  // Wilder RSI
  private rsiReady = false;
  private rsiPeriod = 14;
  private avgGain = 0;
  private avgLoss = 0;
  private lastRsi: number | null = null;
  // ATR (simple last-N TR average, like technical.atr)
  private atrPeriod = 14;
  private trs: { tr: number; high: number; low: number; close: number }[] = [];
  private atrSum = 0;

  /** Full-state init from history (O(n)); afterwards updates are incremental. */
  seed(bars: OhlcvBar[]): void {
    this.reset();
    for (const b of bars.slice(-800)) this.push(b);
  }

  /** Append one bar (live candle update). `closed` hints we can prune. */
  update(bar: OhlcvBar): IncrementalSnapshot {
    return this.push(bar);
  }

  private push(bar: OhlcvBar): IncrementalSnapshot {
    this.closes.push(bar.close);
    this.highs.push(bar.high);
    this.lows.push(bar.low);
    if (this.closes.length > 1000) {
      this.closes.shift();
      this.highs.shift();
      this.lows.shift();
    }
    // EMA stream (always push)
    const e12 = emaPush(this.ema12, bar.close);
    const e26 = emaPush(this.ema26, bar.close);
    // MACD line = ema12 - ema26 (both ready)
    if (e12 != null && e26 != null) {
      const line = e12 - e26;
      this.macdLine.push(line);
      this.lastMacd = line;
      const sig = emaPush(this.macdSignal, line); // signal is EMA over macd-line stream
      this.lastSignal = sig ?? this.lastSignal;
    }
    // Wilder RSI
    this.pushRsi(bar.close);
    // ATR
    this.pushAtr(bar);
    return this.snapshot();
  }

  private pushRsi(close: number): void {
    const last = this.closes.length >= 2 ? this.closes[this.closes.length - 2] : null;
    if (last == null) return;
    const d = close - last;
    if (!this.rsiReady) {
      this.avgGain += Math.max(d, 0);
      this.avgLoss += Math.max(-d, 0);
      const n = this.closes.length - 1;
      if (n === this.rsiPeriod) {
        this.avgGain /= this.rsiPeriod;
        this.avgLoss /= this.rsiPeriod;
        this.rsiReady = true;
        this.lastRsi = this.rsiValue();
      }
      return;
    }
    this.avgGain = (this.avgGain * (this.rsiPeriod - 1) + Math.max(d, 0)) / this.rsiPeriod;
    this.avgLoss = (this.avgLoss * (this.rsiPeriod - 1) + Math.max(-d, 0)) / this.rsiPeriod;
    this.lastRsi = this.rsiValue();
  }

  private rsiValue(): number | null {
    const v = this.avgLoss === 0 ? 100 : 100 - 100 / (1 + this.avgGain / this.avgLoss);
    return Number.isFinite(v) ? v : null;
  }

  private pushAtr(bar: OhlcvBar): void {
    const n = this.highs.length;
    if (n >= 2) {
      const pc = this.closes[n - 2];
      const h = bar.high;
      const l = bar.low;
      const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
      this.trs.push({ tr, high: h, low: l, close: pc });
      this.atrSum += tr;
      if (this.trs.length > this.atrPeriod) {
        this.atrSum -= this.trs.shift()!.tr;
      }
    }
  }

  snapshot(): IncrementalSnapshot {
    const closes = this.closes;
    const last = closes[closes.length - 1] ?? 0;
    return {
      last,
      sma20: this.sma(20),
      sma50: this.sma(50),
      sma200: this.sma(200),
      ema12: this.ema12.value,
      ema26: this.ema26.value,
      rsi14: this.lastRsi,
      macd: this.lastMacd != null && this.lastSignal != null
        ? { macd: this.lastMacd, signal: this.lastSignal, histogram: this.lastMacd - this.lastSignal }
        : null,
      bollinger: this.bollinger(20, 2),
      atr14: this.trs.length === this.atrPeriod ? this.atrSum / this.atrPeriod : null,
      count: closes.length,
    };
  }

  private sma(period: number): number | null {
    const c = this.closes;
    if (c.length < period) return null;
    let sum = 0;
    for (let i = c.length - period; i < c.length; i++) sum += c[i];
    return sum / period;
  }

  private bollinger(period: number, mult: number): { upper: number; mid: number; lower: number } | null {
    const c = this.closes;
    if (c.length < period) return null;
    let sum = 0;
    for (let i = c.length - period; i < c.length; i++) sum += c[i];
    const mid = sum / period;
    let variance = 0;
    for (let i = c.length - period; i < c.length; i++) variance += (c[i] - mid) ** 2;
    const sd = Math.sqrt(variance / period);
    return { upper: mid + mult * sd, mid, lower: mid - mult * sd };
  }

  reset(): void {
    this.closes = [];
    this.highs = [];
    this.lows = [];
    this.ema12 = makeEma(12);
    this.ema26 = makeEma(26);
    this.macdLine = [];
    this.macdSignal = makeEma(9);
    this.lastMacd = null;
    this.lastSignal = null;
    this.rsiReady = false;
    this.avgGain = 0;
    this.avgLoss = 0;
    this.lastRsi = null;
    this.trs = [];
    this.atrSum = 0;
  }
}
