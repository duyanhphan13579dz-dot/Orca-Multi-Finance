import "server-only";
import type { OhlcvBar } from "../types";
import { ema, rsi, sma, macd, annualizedVolatility } from "../technical";

/**
 * MARKET STRUCTURE / STOCK STATE ENGINE — deterministic state detection.
 * LLM never "guesses" accumulation/distribution: the engine computes state
 * from price structure + volume footprint, and hands evidence to the LLM.
 */

export type StockState =
  | "uptrend"
  | "downtrend"
  | "sideways"
  | "accumulation"
  | "distribution"
  | "breakout"
  | "breakdown";

export interface MarketStateResult {
  state: StockState;
  volatility: "low" | "normal" | "high";
  rsiZone: "oversold" | "neutral" | "overbought";
  strength: number; // 0..100
  rangePosition: number; // 0..1 position of close within 120-bar range
  trendScore: number; // -3..+3
  hasVolumeData: boolean;
  evidence: string[];
}

function linregSlope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const xs = Array.from({ length: n }, (_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

const pct = (a: number, b: number) => (b === 0 ? 0 : (a / b - 1) * 100);

export function detectMarketState(bars: OhlcvBar[]): MarketStateResult | null {
  if (bars.length < 60) return null;
  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const vols = bars.map((b) => b.volume);
  const last = closes[closes.length - 1];
  const hasVolume = vols.slice(-30).some((v) => v > 0);
  const evidence: string[] = [];

  /* trend */
  const sma20v = sma(closes, 20);
  const sma50v = sma(closes, 50);
  const s20 = sma20v[closes.length - 1];
  const s20prev = sma20v[closes.length - 11];
  const s50 = sma50v[closes.length - 1];
  const mh = macd(closes).last?.histogram ?? 0;
  let trendScore = 0;
  if (s20 != null) trendScore += last > s20 ? 1 : -1;
  if (s50 != null) trendScore += last > s50 ? 1 : -1;
  if (s20 != null && s50 != null) trendScore += s20 > s50 ? 0.5 : -0.5;
  if (s20 != null && s20prev != null) trendScore += s20 > s20prev ? 0.5 : -0.5;
  trendScore += mh > 0 ? 0.5 : -0.5;
  trendScore = Math.max(-3, Math.min(3, trendScore));

  const ret20 = closes.length > 21 ? pct(last, closes[closes.length - 21]) : 0;

  /* volatility regime: current 30d annualized vol vs own 120d median */
  const vol30 = annualizedVolatility(closes, 30) ?? 0;
  const volSeries: number[] = [];
  for (let i = 40; i <= closes.length; i += 5) {
    const v = annualizedVolatility(closes.slice(0, i), 30);
    if (v != null) volSeries.push(v);
  }
  const medianVol = volSeries.length ? volSeries.sort((a, b) => a - b)[Math.floor(volSeries.length / 2)] : vol30;
  const volRatio = medianVol > 0 ? vol30 / medianVol : 1;
  const volatility = volRatio > 1.35 ? "high" : volRatio < 0.75 ? "low" : "normal";

  /* rsi zone */
  const rsiArr = rsi(closes, 14);
  const rsi14 = rsiArr[closes.length - 1] ?? 50;
  const rsiZone = rsi14 >= 72 ? "overbought" : rsi14 <= 28 ? "oversold" : "neutral";

  /* range position */
  const win = 120;
  const hi = Math.max(...highs.slice(-win));
  const lo = Math.min(...lows.slice(-win));
  const rangePosition = hi > lo ? (last - lo) / (hi - lo) : 0.5;

  /* volume footprint — OBV normalized slope over 30 bars */
  let state: StockState = trendScore >= 1.5 ? "uptrend" : trendScore <= -1.5 ? "downtrend" : "sideways";
  let obvNormSlope = 0;
  if (hasVolume) {
    const obv: number[] = [0];
    for (let i = 1; i < closes.length; i++) {
      obv.push(obv[i - 1] + (closes[i] > closes[i - 1] ? vols[i] : closes[i] < closes[i - 1] ? -vols[i] : 0));
    }
    const avgVol = vols.slice(-30).reduce((a, b) => a + b, 0) / 30;
    obvNormSlope = avgVol > 0 ? linregSlope(obv.slice(-30)) / avgVol : 0;
    if (state === "sideways" && Math.abs(ret20) < 4) {
      if (obvNormSlope > 0.18) state = "accumulation";
      else if (obvNormSlope < -0.18) state = "distribution";
    }
  }

  /* breakout / breakdown (overrides) */
  const priorHigh20 = Math.max(...highs.slice(-21, -1));
  const priorLow20 = Math.min(...lows.slice(-21, -1));
  const volMA20 = hasVolume ? vols.slice(-21, -1).reduce((a, b) => a + b, 0) / 20 : 0;
  const lastVol = vols[vols.length - 1];
  const volSpike = hasVolume && volMA20 > 0 ? lastVol / volMA20 : 0;
  if (last > priorHigh20 * (hasVolume ? 0.999 : 1.002) && (!hasVolume || volSpike >= 1.5)) {
    state = "breakout";
    evidence.push(`Close ${fmt(last)} xuyên đỉnh 20 kỳ ${fmt(priorHigh20)}${hasVolume ? ` kèm vol x${volSpike.toFixed(1)} MA20` : " (thiếu xác nhận vol)"}`);
  } else if (last < priorLow20 * (hasVolume ? 1.001 : 0.998) && (!hasVolume || volSpike >= 1.5)) {
    state = "breakdown";
    evidence.push(`Close ${fmt(last)} thủng đáy 20 kỳ ${fmt(priorLow20)}${hasVolume ? ` kèm vol x${volSpike.toFixed(1)} MA20` : " (thiếu xác nhận vol)"}`);
  }

  /* evidence lines */
  evidence.push(
    `Trend score ${trendScore >= 0 ? "+" : ""}${trendScore.toFixed(1)} · giá ${s20 != null && last > s20 ? "trên" : "dưới"} SMA20, ${s50 != null && last > s50 ? "trên" : "dưới"} SMA50 · 20 kỳ ${ret20 >= 0 ? "+" : ""}${ret20.toFixed(1)}%`,
    `Volatility 30d ${(vol30 * 100).toFixed(1)}% (${(volRatio * 100).toFixed(0)}% so với median của chính nó) → chế độ ${volatility === "high" ? "biến động cao" : volatility === "low" ? "biến động thấp" : "bình thường"}`,
    `RSI14 ${rsi14.toFixed(0)} → ${rsiZone === "overbought" ? "quá mua" : rsiZone === "oversold" ? "quá bán" : "trung tính"} · vị thế trong dải 120 kỳ: ${(rangePosition * 100).toFixed(0)}%`,
  );
  if (hasVolume && state !== "breakout" && state !== "breakdown") {
    evidence.push(
      `OBV slope 30 kỳ ${obvNormSlope >= 0 ? "+" : ""}${(obvNormSlope * 100).toFixed(0)}% ${
        state === "accumulation" ? "→ dòng tiền lặng lẽ gom trong vùng đi ngang" : state === "distribution" ? "→ lực bán thấm dần trong vùng đi ngang" : "→ chưa rõ dấu chân dòng tiền lớn"
      }`,
    );
  }

  const strength = Math.round(
    Math.min(100, Math.abs(trendScore) / 3 * 55 + (state === "breakout" || state === "breakdown" ? 25 : 0) + Math.min(volSpike, 2) / 2 * 10 + Math.min(Math.abs(obvNormSlope), 1) * 10),
  );

  return { state, volatility, rsiZone, strength, rangePosition, trendScore, hasVolumeData: hasVolume, evidence };
}

const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: v >= 100 ? 0 : 2 });

export const STATE_VI: Record<StockState, string> = {
  uptrend: "Xu hướng tăng",
  downtrend: "Xu hướng giảm",
  sideways: "Đi ngang tích lũy",
  accumulation: "Gom hàng (accumulation)",
  distribution: "Phân phối (distribution)",
  breakout: "Bứt phá (breakout)",
  breakdown: "Gãy nền (breakdown)",
};
