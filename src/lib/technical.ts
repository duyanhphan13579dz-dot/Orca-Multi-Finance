import type { CandlePattern, OhlcvBar, TechnicalSnapshot } from "./types";
import { detectCandlePatterns, toLegacyCandlePatterns } from "./engines/candlestick-patterns";
import { computeTradeSignal, type TradeSignal } from "./engines/trade-signal";
import { detectDivergences, divergenceSummaryLine } from "./engines/divergence";

/**
 * Technical analysis engine — deterministic quantitative computations.
 * Candlestick patterns use the VN ruleset engine (candlestick-patterns.ts).
 * tradeSignal = MUA / BÁN / QUAN SÁT + confidence.
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

export function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9,
): { macd: (number | null)[]; signal: (number | null)[]; histogram: (number | null)[] } {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const line: (number | null)[] = closes.map((_, i) =>
    ef[i] != null && es[i] != null ? (ef[i] as number) - (es[i] as number) : null,
  );
  const lineVals = line.map((v) => v ?? 0);
  const sig = ema(lineVals, signal);
  const hist = line.map((v, i) => (v != null && sig[i] != null ? v - (sig[i] as number) : null));
  return { macd: line, signal: sig, histogram: hist };
}

export function stochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
  smooth = 3,
): (number | null)[] {
  const n = closes.length;
  const raw: (number | null)[] = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (highs[j] > hi) hi = highs[j];
      if (lows[j] < lo) lo = lows[j];
    }
    const range = hi - lo;
    raw[i] = range > 1e-12 ? ((closes[i] - lo) / range) * 100 : 50;
  }
  if (smooth <= 1) return raw;
  const out: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (raw[i] == null) continue;
    if (i < period - 1 + smooth - 1) continue;
    let sum = 0;
    let cnt = 0;
    for (let j = i - smooth + 1; j <= i; j++) {
      if (raw[j] != null) {
        sum += raw[j] as number;
        cnt++;
      }
    }
    if (cnt === smooth) out[i] = sum / cnt;
  }
  return out;
}

export function bollinger(
  closes: number[],
  period = 20,
  mult = 2,
): { mid: number; upper: number; lower: number } | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mid = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mid) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return { mid, upper: mid + mult * sd, lower: mid - mult * sd };
}

export function atr(bars: OhlcvBar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const prev = bars[i - 1];
    trs.push(Math.max(b.high - b.low, Math.abs(b.high - prev.close), Math.abs(b.low - prev.close)));
  }
  if (trs.length < period) return null;
  let avg = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) avg = (avg * (period - 1) + trs[i]) / period;
  return avg;
}

export interface MoneyFlowSnapshot {
  cmf20: number | null;
  obvTrend: "inflow" | "outflow" | "neutral" | "unknown";
  volumeRatio20: number | null;
  pressure: number;
  label: "strong-inflow" | "inflow" | "balanced" | "outflow" | "strong-outflow" | "unknown";
}

/** Volume-aware flow proxy that works across stocks, crypto, commodities and tick-based FX. */
export function moneyFlow(bars: OhlcvBar[], period = 20): MoneyFlowSnapshot {
  const usable = bars.filter((b) => Number.isFinite(b.volume) && b.volume > 0);
  if (usable.length < Math.min(period, 5)) {
    return { cmf20: null, obvTrend: "unknown", volumeRatio20: null, pressure: 0, label: "unknown" };
  }
  const recent = usable.slice(-period);
  let flowVolume = 0;
  let totalVolume = 0;
  for (const b of recent) {
    const range = Math.max(b.high - b.low, Math.abs(b.close) * 1e-8);
    const multiplier = ((b.close - b.low) - (b.high - b.close)) / range;
    flowVolume += multiplier * b.volume;
    totalVolume += b.volume;
  }
  const cmf = totalVolume > 0 ? flowVolume / totalVolume : null;
  let obv = 0;
  const obvSeries: number[] = [];
  for (let i = 1; i < usable.length; i++) {
    if (usable[i].close > usable[i - 1].close) obv += usable[i].volume;
    else if (usable[i].close < usable[i - 1].close) obv -= usable[i].volume;
    obvSeries.push(obv);
  }
  const span = Math.min(period, obvSeries.length);
  const obvDelta = span > 1 ? obvSeries.at(-1)! - obvSeries.at(-span)! : 0;
  const avgVolume = recent.reduce((sum, b) => sum + b.volume, 0) / recent.length;
  const lastVolume = usable.at(-1)!.volume;
  const volumeRatio20 = avgVolume > 0 ? lastVolume / avgVolume : null;
  const pressure = Math.max(-1, Math.min(1, (cmf ?? 0) * 0.7 + (obvDelta === 0 ? 0 : Math.sign(obvDelta) * 0.3)));
  const obvTrend = pressure > 0.15 ? "inflow" : pressure < -0.15 ? "outflow" : "neutral";
  const label = pressure >= 0.45 ? "strong-inflow" : pressure >= 0.15 ? "inflow" : pressure <= -0.45 ? "strong-outflow" : pressure <= -0.15 ? "outflow" : "balanced";
  return { cmf20: cmf, obvTrend, volumeRatio20, pressure, label };
}

export function annualizedVolatility(closes: number[], lookback = 30): number | null {
  if (closes.length < lookback + 1) return null;
  const rets: number[] = [];
  for (let i = closes.length - lookback; i < closes.length; i++) {
    const r = Math.log(closes[i] / closes[i - 1]);
    if (Number.isFinite(r)) rets.push(r);
  }
  if (rets.length < 5) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance) * Math.sqrt(252);
}

export function maxDrawdown(closes: number[]): number | null {
  if (closes.length < 2) return null;
  let peak = closes[0];
  let maxDd = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    const dd = (c - peak) / peak;
    if (dd < maxDd) maxDd = dd;
  }
  return maxDd;
}

function pctChange(closes: number[], days: number): number | null {
  if (closes.length < days + 1) return null;
  const prev = closes[closes.length - 1 - days];
  if (!prev) return null;
  return (closes[closes.length - 1] / prev - 1) * 100;
}

export function supportResistance(
  bars: OhlcvBar[],
  lookback = 120,
): { support: number[]; resistance: number[] } {
  const slice = bars.slice(-lookback);
  if (slice.length < 10) return { support: [], resistance: [] };
  const last = slice[slice.length - 1].close;
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = 2; i < slice.length - 2; i++) {
    const b = slice[i];
    if (
      b.high >= slice[i - 1].high &&
      b.high >= slice[i - 2].high &&
      b.high >= slice[i + 1].high &&
      b.high >= slice[i + 2].high
    )
      highs.push(b.high);
    if (
      b.low <= slice[i - 1].low &&
      b.low <= slice[i - 2].low &&
      b.low <= slice[i + 1].low &&
      b.low <= slice[i + 2].low
    )
      lows.push(b.low);
  }
  const cluster = (levels: number[], below: boolean): number[] => {
    const tolFor = (p: number) => p * 0.005;
    const sorted = levels
      .filter((l) => (below ? l < last * 0.995 : l > last * 1.005))
      .sort((a, b) => (below ? b - a : a - b));
    const out: number[] = [];
    for (const l of sorted) {
      if (out.some((o) => Math.abs(o - l) <= tolFor(l))) continue;
      out.push(l);
      if (out.length >= 3) break;
    }
    return out;
  };
  return { support: cluster(lows, true), resistance: cluster(highs, false) };
}

export function detectPatterns(bars: OhlcvBar[]): CandlePattern[] {
  return toLegacyCandlePatterns(detectCandlePatterns(bars));
}

export function analyzeSeries(bars: OhlcvBar[]): TechnicalSnapshot | null {
  const byTime = new Map<number, OhlcvBar>();
  for (const bar of bars) {
    if (
      Number.isFinite(bar.time) &&
      Number.isFinite(bar.open) &&
      Number.isFinite(bar.high) &&
      Number.isFinite(bar.low) &&
      Number.isFinite(bar.close) &&
      bar.high >= bar.low &&
      bar.close > 0
    )
      byTime.set(bar.time, {
        ...bar,
        volume: Number.isFinite(bar.volume) ? Math.max(0, bar.volume) : 0,
      });
  }
  const normalizedBars = [...byTime.values()].sort((a, b) => a.time - b.time);
  if (normalizedBars.length < 30) return null;
  const deduplicated = normalizedBars.length !== bars.length;
  bars = normalizedBars;
  const closes = bars.map((b) => b.close);
  const last = closes[closes.length - 1];
  const rsiSeries = rsi(closes, 14);
  const rsi14 = rsiSeries[closes.length - 1] ?? null;
  const macdFull = macd(closes);
  const macdRes =
    macdFull.macd[closes.length - 1] != null && macdFull.signal[closes.length - 1] != null
      ? {
          macd: macdFull.macd[closes.length - 1] as number,
          signal: macdFull.signal[closes.length - 1] as number,
          histogram: (macdFull.histogram[closes.length - 1] as number) ?? 0,
        }
      : null;
  const smaArr = (p: number) => sma(closes, p)[closes.length - 1] ?? null;
  const emaArr = (p: number) => ema(closes, p)[closes.length - 1] ?? null;
  const sma20 = smaArr(20);
  const sma50 = smaArr(50);
  const sma200 = smaArr(200);
  const bb = bollinger(closes, 20, 2);
  const atr14 = atr(bars, 14);
  const vol = annualizedVolatility(closes, 30);
  const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();
  const ytdBase = bars.filter((b) => b.time < yearStart).pop();
  const ytd = ytdBase && ytdBase.close ? (last / ytdBase.close - 1) * 100 : pctChange(closes, 250);
  const highs = bars.slice(-252).map((b) => b.high);
  const lows = bars.slice(-252).map((b) => b.low);
  const high52w = highs.length ? Math.max(...highs) : null;
  const low52w = lows.length ? Math.min(...lows) : null;
  const sr = supportResistance(bars);
  const flow = moneyFlow(bars);

  let score = 0;
  if (sma20 != null) score += last > sma20 ? 1 : -1;
  if (sma50 != null) score += last > sma50 ? 1 : -1;
  if (sma200 != null) score += last > sma200 ? 1 : -1;
  if (sma20 != null && sma50 != null) score += sma20 > sma50 ? 0.5 : -0.5;
  if (macdRes) score += macdRes.histogram > 0 ? 0.5 : -0.5;
  if (rsi14 != null) score += rsi14 > 55 ? 0.5 : rsi14 < 45 ? -0.5 : 0;
  score = Math.max(-3, Math.min(3, score));
  const label =
    score >= 2
      ? "strong-up"
      : score >= 0.5
        ? "up"
        : score <= -2
          ? "strong-down"
          : score <= -0.5
            ? "down"
            : "sideways";

  const signals: string[] = [];
  if (rsi14 != null) {
    if (rsi14 >= 70) signals.push("RSI quá mua (>70) — dễ rung lắc ngắn hạn");
    else if (rsi14 <= 30) signals.push("RSI quá bán (<30) — khả năng hồi kỹ thuật");
    else signals.push(`RSI ${rsi14.toFixed(0)} — vùng cân bằng`);
  }
  if (macdRes) {
    signals.push(macdRes.histogram > 0 ? "MACD hỗ trợ xu hướng tăng" : "MACD nghiêng về áp lực bán");
    const previousHistogram = macdFull.histogram[closes.length - 2];
    if (previousHistogram != null && previousHistogram <= 0 && macdRes.histogram > 0)
      signals.push("MACD vừa cắt lên đường tín hiệu — động lượng tăng mới hình thành");
    if (previousHistogram != null && previousHistogram >= 0 && macdRes.histogram < 0)
      signals.push("MACD vừa cắt xuống đường tín hiệu — động lượng giảm mới hình thành");
  }
  if (sma50 != null)
    signals.push(
      last > sma50
        ? "Giá duy trì trên SMA50 — xu hướng trung hạn còn nguyên"
        : "Giá nằm dưới SMA50 — xu hướng trung hạn suy yếu",
    );
  if (bb) {
    const pos = (last - bb.lower) / (bb.upper - bb.lower);
    if (pos > 0.95) signals.push("Chạm biên trên Bollinger — độ nóng cao");
    else if (pos < 0.05) signals.push("Chạm biên dưới Bollinger — vùng hỗ trợ kỹ thuật");
  }
  if (high52w != null && last >= high52w * 0.98) signals.push("Tiệm cận đỉnh 52 tuần");
  if (low52w != null && last <= low52w * 1.02) signals.push("Tiệm cận đáy 52 tuần");
  if (flow.label !== "unknown") {
    const ratio = flow.volumeRatio20 != null ? ` · vol ${flow.volumeRatio20.toFixed(1)}x TB20` : "";
    signals.push(
      flow.label.includes("inflow")
        ? `Dòng tiền vào${ratio} · CMF ${flow.cmf20?.toFixed(2) ?? "n/a"}`
        : flow.label.includes("outflow")
          ? `Dòng tiền ra${ratio} · CMF ${flow.cmf20?.toFixed(2) ?? "n/a"}`
          : `Dòng tiền cân bằng${ratio}`,
    );
  }

  const candlePatterns = detectCandlePatterns(bars, {
    assetClass: "stock",
    recentBars: 5,
    maxAgeBars: 4,
  });
  const candleClusters = candlePatterns
    .filter((p) => p.category !== "neutral")
    .slice(0, 6)
    .map((p) => ({
      name: p.nameVi,
      category: p.category,
      score: p.score,
      ageBars: p.ageBars ?? 0,
      candles: p.candles,
    }));
  for (const p of candleClusters.slice(0, 3)) {
    signals.push(`${p.category.includes("reversal") ? "Cụm đảo chiều" : "Cụm tiếp diễn"}: ${p.name}`);
  }

  const divergences = detectDivergences(bars, { lookback: 180, maxSignals: 8 });
  for (const d of divergences.slice(0, 4)) {
    signals.push(divergenceSummaryLine(d));
  }

  const latestBarTime = bars[bars.length - 1]!.time;
  const ageMs = Math.max(0, Date.now() - latestBarTime);

  let macdCross: "bull" | "bear" | null = null;
  if (macdRes && macdFull.histogram[closes.length - 2] != null) {
    const prevH = macdFull.histogram[closes.length - 2] as number;
    if (prevH <= 0 && macdRes.histogram > 0) macdCross = "bull";
    if (prevH >= 0 && macdRes.histogram < 0) macdCross = "bear";
  }

  const tradeSignal: TradeSignal = computeTradeSignal(candlePatterns, {
    trendScore: score,
    trendLabel: label,
    rsi14,
    macdHistogram: macdRes?.histogram ?? null,
    macdCross,
    priceAboveSma20: sma20 != null ? last > sma20 : null,
    priceAboveSma50: sma50 != null ? last > sma50 : null,
  });

  return {
    last,
    rsi14,
    macd: macdRes,
    sma: { sma20, sma50, sma200 },
    ema: { ema12: emaArr(12), ema26: emaArr(26) },
    bollinger: bb,
    atr14,
    moneyFlow: flow,
    volatility30d: vol,
    maxDrawdown: maxDrawdown(closes.slice(-252)),
    returns: {
      d7: pctChange(closes, 7),
      d30: pctChange(closes, 30),
      ytd: ytd ?? null,
      y1: pctChange(closes, 252),
    },
    high52w,
    low52w,
    support: sr.support,
    resistance: sr.resistance,
    trend: { score, label },
    signals,
    divergences,
    candleClusters,
    tradeSignal,
    dataQuality: {
      bars: bars.length,
      latestBarTime,
      ageMs,
      stale: ageMs > 36 * 60 * 60 * 1000,
      deduplicated,
    },
  };
}
