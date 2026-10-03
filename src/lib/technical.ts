import type { CandlePattern, OhlcvBar, TechnicalSnapshot } from "./types";
import { detectCandlePatterns, toLegacyCandlePatterns } from "./engines/candlestick-patterns";
import { computeTradeSignal, type TradeSignal } from "./engines/trade-signal";
import { buildStockTradePlan } from "./engines/stock-trade-plan";
import { detectDivergences, divergenceSummaryLine } from "./engines/divergence";
import { analyzeMoneyFlow } from "./engines/money-flow";

/**
 * Technical analysis engine — deterministic quantitative computations.
 * Candlestick patterns use the VN ruleset engine (candlestick-patterns.ts).
 * tradeSignal = MUA / BÁN / QUAN SÁT + confidence (+ Entry/SL/TP plan).
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
    emaFast[i] != null && emaSlow[i] != null ? (emaFast[i] as number) - (emaSlow[i] as number) : null,
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

export function bollinger(
  values: number[],
  period = 20,
  mult = 2,
): { upper: (number | null)[]; mid: (number | null)[]; lower: (number | null)[] } {
  const mid = sma(values, period);
  const upper: (number | null)[] = new Array(values.length).fill(null);
  const lower: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    if (mid[i] == null) continue;
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j] - (mid[i] as number);
      sumSq += d * d;
    }
    const sd = Math.sqrt(sumSq / period);
    upper[i] = (mid[i] as number) + mult * sd;
    lower[i] = (mid[i] as number) - mult * sd;
  }
  return { upper, mid, lower };
}

export function atr(bars: OhlcvBar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    const pc = bars[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  if (trs.length < period) return null;
  let avg = 0;
  for (let i = 0; i < period; i++) avg += trs[i];
  avg /= period;
  for (let i = period; i < trs.length; i++) {
    avg = (avg * (period - 1) + trs[i]) / period;
  }
  return avg;
}

export function supportResistance(
  bars: OhlcvBar[],
  lookback = 60,
): { support: number[]; resistance: number[] } {
  const slice = bars.slice(-lookback);
  if (slice.length < 10) return { support: [], resistance: [] };
  const lows = slice.map((b) => b.low).sort((a, b) => a - b);
  const highs = slice.map((b) => b.high).sort((a, b) => a - b);
  const support = [lows[Math.floor(lows.length * 0.15)], lows[Math.floor(lows.length * 0.3)]].filter(
    (v, i, a) => a.indexOf(v) === i,
  );
  const resistance = [
    highs[Math.floor(highs.length * 0.7)],
    highs[Math.floor(highs.length * 0.85)],
  ].filter((v, i, a) => a.indexOf(v) === i);
  return { support, resistance };
}

function pctChange(closes: number[], barsBack: number): number | null {
  if (closes.length <= barsBack) return null;
  const a = closes[closes.length - 1];
  const b = closes[closes.length - 1 - barsBack];
  if (!b) return null;
  return ((a - b) / b) * 100;
}

function maxDrawdown(closes: number[]): number | null {
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

function volatility(closes: number[], period = 20): number | null {
  if (closes.length < period + 1) return null;
  const rets: number[] = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    if (closes[i - 1] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance * 252);
}

/** Build full technical snapshot from OHLCV bars. */
export function buildTechnicalSnapshot(barsIn: OhlcvBar[]): TechnicalSnapshot | null {
  if (!barsIn?.length || barsIn.length < 30) return null;

  // Deduplicate by time ascending
  const byTime = new Map<number, OhlcvBar>();
  for (const b of barsIn) {
    if (b && Number.isFinite(b.time) && b.time > 0 && Number.isFinite(b.close) && b.close > 0) {
      byTime.set(b.time, b);
    }
  }
  const bars = [...byTime.values()].sort((a, b) => a.time - b.time);
  const deduplicated = bars.length < barsIn.length;
  if (bars.length < 30) return null;

  const closes = bars.map((b) => b.close);
  const last = closes[closes.length - 1]!;
  const rsiSeries = rsi(closes, 14);
  const rsi14 = rsiSeries[rsiSeries.length - 1] ?? null;
  const macdFull = macd(closes);
  const macdRes =
    macdFull.macd[closes.length - 1] != null
      ? {
          macd: macdFull.macd[closes.length - 1] as number,
          signal: (macdFull.signal[closes.length - 1] as number) ?? 0,
          histogram: (macdFull.histogram[closes.length - 1] as number) ?? 0,
        }
      : null;
  const sma20 = sma(closes, 20)[closes.length - 1] ?? null;
  const sma50 = sma(closes, 50)[closes.length - 1] ?? null;
  const sma200 = sma(closes, 200)[closes.length - 1] ?? null;
  const emaArr = (p: number) => ema(closes, p)[closes.length - 1] ?? null;
  const bbFull = bollinger(closes);
  const bb =
    bbFull.mid[closes.length - 1] != null
      ? {
          upper: bbFull.upper[closes.length - 1] as number,
          mid: bbFull.mid[closes.length - 1] as number,
          lower: bbFull.lower[closes.length - 1] as number,
        }
      : null;
  const atr14 = atr(bars, 14);
  const vol = volatility(closes, 20);
  const sr = supportResistance(bars);
  const high52w = Math.max(...closes.slice(-252));
  const low52w = Math.min(...closes.slice(-252));

  // Trend score
  let score = 0;
  if (sma20 != null && last > sma20) score += 15;
  else if (sma20 != null) score -= 15;
  if (sma50 != null && last > sma50) score += 20;
  else if (sma50 != null) score -= 20;
  if (sma200 != null && last > sma200) score += 25;
  else if (sma200 != null) score -= 25;
  if (sma20 != null && sma50 != null) {
    if (sma20 > sma50) score += 10;
    else score -= 10;
  }
  if (rsi14 != null) {
    if (rsi14 > 55) score += 8;
    else if (rsi14 < 45) score -= 8;
  }
  if (macdRes) {
    if (macdRes.histogram > 0) score += 12;
    else score -= 12;
  }
  score = Math.max(-100, Math.min(100, score));
  const label =
    score >= 50
      ? "strong-up"
      : score >= 15
        ? "up"
        : score <= -50
          ? "strong-down"
          : score <= -15
            ? "down"
            : "sideways";

  const moneyFlowAnalysis = analyzeMoneyFlow(bars);
  const flow = moneyFlowAnalysis
    ? {
        cmf20: moneyFlowAnalysis.cmf20,
        obvTrend: moneyFlowAnalysis.obvTrend,
        volumeRatio20: moneyFlowAnalysis.volumeRatio20,
        pressure: moneyFlowAnalysis.pressure,
        label: moneyFlowAnalysis.label,
      }
    : undefined;

  const divergences = detectDivergences(bars, { rsi: rsiSeries, macdHist: macdFull.histogram });
  const candlePatterns = detectCandlePatterns(bars);
  const candleClusters = candlePatterns.slice(0, 8).map((p) => ({
    name: p.name,
    category: p.category,
    score: p.score,
    ageBars: p.ageBars ?? 0,
    candles: p.candles ?? 1,
  }));

  const signals: string[] = [];
  if (rsi14 != null) {
    if (rsi14 >= 70) signals.push(`RSI quá mua (${rsi14.toFixed(1)})`);
    else if (rsi14 <= 30) signals.push(`RSI quá bán (${rsi14.toFixed(1)})`);
  }
  if (macdRes) {
    if (macdRes.histogram > 0 && macdRes.macd > macdRes.signal) signals.push("MACD dương / bullish");
    if (macdRes.histogram < 0 && macdRes.macd < macdRes.signal) signals.push("MACD âm / bearish");
  }
  for (const d of divergences.slice(0, 3)) {
    signals.push(divergenceSummaryLine(d));
  }
  if (moneyFlowAnalysis) {
    if (moneyFlowAnalysis.smc.fvg) {
      const f = moneyFlowAnalysis.smc.fvg;
      signals.push(
        `FVG ${f.direction === "bullish" ? "bullish" : "bearish"} ${f.status} · ${f.low.toFixed(2)}–${f.high.toFixed(2)}`,
      );
    }
    if (moneyFlowAnalysis.smc.orderBlock && moneyFlowAnalysis.smc.orderBlock.status !== "BREAKER") {
      const ob = moneyFlowAnalysis.smc.orderBlock;
      signals.push(
        `Order Block ${ob.direction === "bullish" ? "bullish" : "bearish"} ${ob.status ?? "OPEN"} · ${ob.low.toFixed(2)}–${ob.high.toFixed(2)}`,
      );
    }
    if (moneyFlowAnalysis.ict.inOte) {
      signals.push(
        `Giá trong OTE (${moneyFlowAnalysis.ict.premiumDiscount}) — vùng entry ICT ưu tiên`,
      );
    } else if (moneyFlowAnalysis.ict.premiumDiscount !== "EQUILIBRIUM") {
      signals.push(`ICT ${moneyFlowAnalysis.ict.premiumDiscount} zone`);
    }
    for (const ev of moneyFlowAnalysis.vsa.events.slice(0, 3)) {
      signals.push(`VSA: ${ev}`);
    }
  }

  const latestBarTime = bars[bars.length - 1]!.time;
  const ageMs = Math.max(0, Date.now() - latestBarTime);

  let macdCross: "bull" | "bear" | null = null;
  if (macdRes && macdFull.histogram[closes.length - 2] != null) {
    const prevH = macdFull.histogram[closes.length - 2] as number;
    if (prevH <= 0 && macdRes.histogram > 0) macdCross = "bull";
    if (prevH >= 0 && macdRes.histogram < 0) macdCross = "bear";
  }

  const tradeSignalBase: TradeSignal = computeTradeSignal(candlePatterns, {
    trendScore: score,
    trendLabel: label,
    rsi14,
    macdHistogram: macdRes?.histogram ?? null,
    macdCross,
    priceAboveSma20: sma20 != null ? last > sma20 : null,
    priceAboveSma50: sma50 != null ? last > sma50 : null,
  });

  let plan = null as ReturnType<typeof buildStockTradePlan>;
  if (tradeSignalBase.action === "buy" || tradeSignalBase.action === "sell") {
    plan = buildStockTradePlan(tradeSignalBase.action, {
      last,
      atr14,
      support: sr.support,
      resistance: sr.resistance,
      volatility30d: vol,
    });
  }
  const tradeSignal = { ...tradeSignalBase, plan };

  // YTD: approximate from calendar if timestamps available
  let ytd: number | null = null;
  const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();
  const ytdBar = bars.find((b) => b.time >= yearStart);
  if (ytdBar && ytdBar.close > 0) ytd = ((last - ytdBar.close) / ytdBar.close) * 100;

  return {
    last,
    rsi14,
    macd: macdRes,
    sma: { sma20, sma50, sma200 },
    ema: { ema12: emaArr(12), ema26: emaArr(26) },
    bollinger: bb,
    atr14,
    moneyFlow: flow,
    moneyFlowAnalysis,
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

// Re-export helpers used elsewhere
export { toLegacyCandlePatterns };
export type { CandlePattern };
