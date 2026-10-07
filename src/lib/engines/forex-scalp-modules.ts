import type { OhlcvBar } from "../types";
import { atr, ema, macd, rsi, supportResistance } from "../technical";
import type {
  ForexFilterResult,
  ForexMarketRegime,
  ForexRegimeSnapshot,
  ForexScalpDirection,
  ForexScalpInput,
  ForexScalpSetup,
  ForexSetupStatus,
  ForexTier,
  ForexVolatilityRegime,
} from "./forex-scalp-types";

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const bodyOf = (b: OhlcvBar) => Math.abs(b.close - b.open);
const rangeOf = (b: OhlcvBar) => Math.max(b.high - b.low, 1e-12);
const isBull = (b: OhlcvBar) => b.close > b.open;
const isBear = (b: OhlcvBar) => b.close < b.open;
const lowerWickOf = (b: OhlcvBar) => Math.min(b.close, b.open) - b.low;
const upperWickOf = (b: OhlcvBar) => b.high - Math.max(b.close, b.open);

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function avgBody(bars: OhlcvBar[], n = 10): number {
  const slice = bars.slice(-n - 1, -1);
  if (!slice.length) return 0;
  return slice.reduce((a, b) => a + bodyOf(b), 0) / slice.length;
}

const fmt = (v: number, digits = 5) =>
  v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function pipSize(pair: string): number {
  const p = pair.toUpperCase().replace("/", "");
  if (p.endsWith("JPY") || p.startsWith("JPY")) return 0.01;
  if (p.endsWith("VND")) return 1;
  return 0.0001;
}

export function toPips(pair: string, priceDelta: number): number {
  return Math.abs(priceDelta) / pipSize(pair);
}

const TIER_A = new Set(["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD"]);
const TIER_B = new Set(["EURJPY", "GBPJPY", "EURGBP", "AUDJPY", "EURAUD", "GBPAUD", "EURCHF", "CADJPY"]);

const MAX_SPREAD: Record<ForexTier, number> = {
  A: 2.0,
  B: 3.5,
  C: 6.0,
  EXCLUDED: 0,
};

export function classifyForexTier(pair: string): ForexTier {
  const p = pair.toUpperCase().replace("/", "");
  if (TIER_A.has(p)) return "A";
  if (TIER_B.has(p)) return "B";
  if (p.includes("VND") || p.includes("TRY") || p.includes("ZAR") || p.includes("MXN")) return "C";
  return "C";
}

export function sessionInfo(pair: string, nowMs = Date.now()): { ok: boolean; label: string } {
  const d = new Date(nowMs);
  const utcH = d.getUTCHours() + d.getUTCMinutes() / 60;
  const month = d.getUTCMonth() + 1;
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return { ok: false, label: "WEEKEND" };

  const dst = month >= 3 && month <= 10;
  const londonOpen = dst ? 7 : 8;
  const londonClose = dst ? 16 : 17;
  const nyOpen = dst ? 12 : 13;
  const nyClose = dst ? 21 : 22;
  const asiaOpen = 0;
  const asiaClose = 9;

  const inLondon = utcH >= londonOpen && utcH < londonClose;
  const inNy = utcH >= nyOpen && utcH < nyClose;
  const inAsia = utcH >= asiaOpen && utcH < asiaClose;
  const overlap = inLondon && inNy;

  // Soften rollover: still ok for analysis, flagged as elevated risk
  if (utcH >= 20.9 && utcH <= 21.6) return { ok: true, label: "ROLLOVER" };

  const p = pair.toUpperCase().replace("/", "");
  if (overlap) return { ok: true, label: "LONDON_NY_OVERLAP" };
  if (p.includes("JPY") || p.startsWith("AUD") || p.startsWith("NZD")) {
    if (inAsia || inLondon) return { ok: true, label: inAsia ? "ASIA" : "LONDON" };
  }
  if (inLondon || inNy) return { ok: true, label: inLondon ? "LONDON" : "NEW_YORK" };
  // Allow analysis off-session (soft gate) — strength will be discounted upstream
  return { ok: true, label: "OFF_SESSION" };
}

export function newsFilterOk(_pair: string, _nowMs = Date.now()): { ok: boolean; reason?: string } {
  return { ok: true };
}

export function runForexFilter(input: ForexScalpInput): ForexFilterResult {
  const pair = input.pair.toUpperCase().replace("/", "");
  const tier = classifyForexTier(pair);
  const maxSpreadPips = MAX_SPREAD[tier];
  const reasons: string[] = [];

  let spreadPips = input.spreadPips ?? null;
  if (spreadPips == null && input.bid != null && input.ask != null && input.ask > input.bid) {
    spreadPips = toPips(pair, input.ask - input.bid);
  }

  const spreadOk = spreadPips == null || spreadPips <= maxSpreadPips;
  if (spreadPips != null && !spreadOk) {
    reasons.push(`Spread ${spreadPips.toFixed(1)} pip > max ${maxSpreadPips} (tier ${tier})`);
  }

  const session = sessionInfo(pair, input.nowMs ?? Date.now());
  if (session.label === "OFF_SESSION" || session.label === "ROLLOVER" || session.label === "WEEKEND") {
    reasons.push(`Session filter: ${session.label} — strength giảm, mức giá minh họa`);
  }

  const news = newsFilterOk(pair, input.nowMs ?? Date.now());
  if (!news.ok) reasons.push(news.reason ?? "News lock window");

  const dataOk = input.barsM5.length >= 40;
  if (!dataOk) reasons.push("Thieu du lieu M5");

  if (tier === "EXCLUDED") reasons.push("Pair excluded from universe");

  // Hard blocks: excluded pair, missing data, extreme spread only
  // Session is soft — strategies still run
  const hardBlock = tier === "EXCLUDED" || !dataOk || !spreadOk || !news.ok;
  const eligible = !hardBlock;
  if (eligible && session.label !== "OFF_SESSION" && session.label !== "ROLLOVER" && session.label !== "WEEKEND") {
    reasons.push(`Pass filter | tier ${tier} | ${session.label}`);
  } else if (eligible) {
    reasons.push(`Soft pass | tier ${tier} | ${session.label}`);
  }

  return {
    eligible,
    tier,
    spreadOk,
    sessionOk: session.ok && session.label !== "OFF_SESSION" && session.label !== "ROLLOVER" && session.label !== "WEEKEND",
    newsOk: news.ok,
    spreadPips,
    maxSpreadPips,
    sessionLabel: session.label,
    reasons,
  };
}

export function detectForexRegime(barsM15: OhlcvBar[], pair: string): ForexRegimeSnapshot {
  const evidence: string[] = [];
  const atrV = atr(barsM15, 14);
  const atrPips = atrV != null ? toPips(pair, atrV) : null;

  const atrSeries: number[] = [];
  for (let i = 20; i <= barsM15.length; i += 2) {
    const a = atr(barsM15.slice(0, i), 14);
    if (a != null) atrSeries.push(a);
  }
  const medAtr = median(atrSeries);
  const atrRatio = atrV != null && medAtr > 0 ? atrV / medAtr : null;

  let volatility: ForexVolatilityRegime = "NORMAL";
  if (atrRatio != null) {
    if (atrRatio >= 2.2) volatility = "EXTREME_VOLATILITY";
    else if (atrRatio >= 1.45) volatility = "HIGH_VOLATILITY";
    else if (atrRatio <= 0.65) volatility = "LOW_VOLATILITY";
  }
  evidence.push(
    `ATR M15 ${atrPips != null ? atrPips.toFixed(1) + " pip" : "?"} | ratio ${atrRatio?.toFixed(2) ?? "?"} -> ${volatility}`,
  );

  const closes = barsM15.map((b) => b.close);
  const highs = barsM15.map((b) => b.high);
  const lows = barsM15.map((b) => b.low);
  const look = Math.min(20, barsM15.length - 2);
  const recentHighs = highs.slice(-look);
  const recentLows = lows.slice(-look);
  const hh = recentHighs[recentHighs.length - 1] > Math.max(...recentHighs.slice(0, -3));
  const hl = recentLows[recentLows.length - 1] > Math.min(...recentLows.slice(0, -3));
  const lh = recentHighs[recentHighs.length - 1] < Math.min(...recentHighs.slice(0, -3));
  const ll = recentLows[recentLows.length - 1] < Math.max(...recentLows.slice(0, -3));

  const e9 = ema(closes, 9)[closes.length - 1];
  const e21 = ema(closes, 21)[closes.length - 1];
  const emaUp = e9 != null && e21 != null && e9 > e21;
  const emaDown = e9 != null && e21 != null && e9 < e21;

  const ret6 = closes.length > 7 ? Math.abs(closes[closes.length - 1] / closes[closes.length - 7] - 1) * 100 : 0;
  let market: ForexMarketRegime = "RANGING";
  if (volatility === "EXTREME_VOLATILITY" && ret6 > 0.8) market = "CHAOTIC";
  else if ((hh && hl) || (emaUp && !ll)) market = "TRENDING_UP";
  else if ((lh && ll) || (emaDown && !hh)) market = "TRENDING_DOWN";

  evidence.push(`M15 structure ${hh ? "HH " : ""}${hl ? "HL " : ""}${lh ? "LH " : ""}${ll ? "LL " : ""}-> ${market}`);
  return { volatility, market, atrPips, atrRatio, evidence };
}

/** Build ATR-based entry / SL / TP for a directional bias. */
function levelsFromBias(
  pair: string,
  direction: "BUY" | "SELL",
  entry: number,
  bars: OhlcvBar[],
  rr = 1.5,
): { stopLoss: number; takeProfit: number; stopPips: number; riskReward: number } {
  const atrV = atr(bars, 14) ?? rangeOf(bars[bars.length - 1]);
  const stopDist = Math.max(atrV * 0.9, pipSize(pair) * 5);
  const stopLoss = direction === "BUY" ? entry - stopDist : entry + stopDist;
  const takeProfit = direction === "BUY" ? entry + stopDist * rr : entry - stopDist * rr;
  return {
    stopLoss,
    takeProfit,
    stopPips: toPips(pair, stopDist),
    riskReward: rr,
  };
}

/**
 * Strategy T — technical confluence: candle patterns + EMA/RSI/MACD.
 * Always produces concrete entry/SL/TP when a direction is found.
 */
export function strategyTech(
  pair: string,
  barsM5: OhlcvBar[],
  barsM15: OhlcvBar[],
  regime: ForexRegimeSnapshot,
  sessionSoftPenalty: number,
): ForexScalpSetup | null {
  if (barsM5.length < 40) return null;
  if (regime.volatility === "EXTREME_VOLATILITY") return null;

  const bars = barsM5;
  const closes = bars.map((b) => b.close);
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const prev2 = bars[bars.length - 3];
  const body = bodyOf(last);
  const avgB = avgBody(bars, 12);
  const uW = upperWickOf(last);
  const lW = lowerWickOf(last);

  const rsiArr = rsi(closes, 14);
  const rsiLast = rsiArr[closes.length - 1];
  const macdRes = macd(closes).last;
  const e9 = ema(closes, 9)[closes.length - 1];
  const e21 = ema(closes, 21)[closes.length - 1];

  let score = 0;
  const evidence: string[] = [];
  const riskNotes: string[] = [];

  // --- Candle patterns (recent 1–3 bars) ---
  let patternBias: ForexScalpDirection = "NONE";
  if (prev.close < prev.open && last.close > last.open && body > avgB * 0.9 && body > bodyOf(prev) * 1.05 && last.close >= prev.open && last.open <= prev.close) {
    patternBias = "BUY";
    score += 22;
    evidence.push("Bullish Engulfing M5");
  } else if (prev.close > prev.open && last.close < last.open && body > avgB * 0.9 && body > bodyOf(prev) * 1.05 && last.close <= prev.open && last.open >= prev.close) {
    patternBias = "SELL";
    score += 22;
    evidence.push("Bearish Engulfing M5");
  } else if (lW > body * 1.8 && uW < body * 0.6 && isBull(last)) {
    patternBias = "BUY";
    score += 16;
    evidence.push("Hammer / rejection nến dưới M5");
  } else if (uW > body * 1.8 && lW < body * 0.6 && isBear(last)) {
    patternBias = "SELL";
    score += 16;
    evidence.push("Shooting Star / rejection nến trên M5");
  } else if (
    bodyOf(prev2) > avgB * 1.1 &&
    isBear(prev2) &&
    bodyOf(prev) < avgB * 0.55 &&
    isBull(last) &&
    body > avgB * 1.0 &&
    last.close > (prev2.open + prev2.close) / 2
  ) {
    patternBias = "BUY";
    score += 20;
    evidence.push("Morning Star-like M5");
  } else if (
    bodyOf(prev2) > avgB * 1.1 &&
    isBull(prev2) &&
    bodyOf(prev) < avgB * 0.55 &&
    isBear(last) &&
    body > avgB * 1.0 &&
    last.close < (prev2.open + prev2.close) / 2
  ) {
    patternBias = "SELL";
    score += 20;
    evidence.push("Evening Star-like M5");
  }

  // --- EMA trend ---
  if (e9 != null && e21 != null) {
    if (e9 > e21 && last.close > e9) {
      score += patternBias === "SELL" ? 4 : 14;
      evidence.push("EMA9 > EMA21 + giá trên EMA9");
      if (patternBias === "NONE") patternBias = "BUY";
    } else if (e9 < e21 && last.close < e9) {
      score += patternBias === "BUY" ? 4 : 14;
      evidence.push("EMA9 < EMA21 + giá dưới EMA9");
      if (patternBias === "NONE") patternBias = "SELL";
    }
  }

  // --- RSI ---
  if (rsiLast != null) {
    if (rsiLast <= 32) {
      score += patternBias === "SELL" ? 2 : 12;
      evidence.push(`RSI ${rsiLast.toFixed(0)} quá bán`);
      if (patternBias === "NONE") patternBias = "BUY";
    } else if (rsiLast >= 68) {
      score += patternBias === "BUY" ? 2 : 12;
      evidence.push(`RSI ${rsiLast.toFixed(0)} quá mua`);
      if (patternBias === "NONE") patternBias = "SELL";
    } else if (rsiLast >= 55 && (patternBias === "BUY" || regime.market === "TRENDING_UP")) {
      score += 6;
      evidence.push(`RSI ${rsiLast.toFixed(0)} ủng hộ long`);
    } else if (rsiLast <= 45 && (patternBias === "SELL" || regime.market === "TRENDING_DOWN")) {
      score += 6;
      evidence.push(`RSI ${rsiLast.toFixed(0)} ủng hộ short`);
    }
  }

  // --- MACD ---
  if (macdRes) {
    if (macdRes.histogram > 0) {
      score += patternBias === "SELL" ? 3 : 10;
      evidence.push("MACD histogram +");
      if (patternBias === "NONE") patternBias = "BUY";
    } else {
      score += patternBias === "BUY" ? 3 : 10;
      evidence.push("MACD histogram −");
      if (patternBias === "NONE") patternBias = "SELL";
    }
  }

  // --- Regime alignment ---
  if (patternBias === "BUY" && regime.market === "TRENDING_UP") {
    score += 12;
    evidence.push("Khớp TRENDING_UP");
  } else if (patternBias === "SELL" && regime.market === "TRENDING_DOWN") {
    score += 12;
    evidence.push("Khớp TRENDING_DOWN");
  } else if (patternBias === "BUY" && regime.market === "TRENDING_DOWN") {
    score -= 10;
    riskNotes.push("Counter-trend vs TRENDING_DOWN");
  } else if (patternBias === "SELL" && regime.market === "TRENDING_UP") {
    score -= 10;
    riskNotes.push("Counter-trend vs TRENDING_UP");
  }

  // Soft session penalty
  score = Math.round(score * sessionSoftPenalty);

  if (patternBias === "NONE" || score < 18) return null;

  const direction = patternBias;
  const entry = last.close;
  const lv = levelsFromBias(pair, direction, entry, barsM15.length >= 30 ? barsM15 : bars, 1.5);
  const strength = clamp(score, 0, 92);
  const status: ForexSetupStatus = strength >= 55 ? "TRIGGERED" : "ACTIVE";

  if (sessionSoftPenalty < 1) riskNotes.push("Ngoài phiên chính — mức giá minh họa, giảm size");
  if (regime.volatility === "HIGH_VOLATILITY") riskNotes.push("HIGH_VOLATILITY — siết risk");

  return {
    strategy: "A", // surface as A-family in UI; evidence tags technical
    direction,
    status,
    strength,
    entry,
    stopLoss: lv.stopLoss,
    takeProfit: lv.takeProfit,
    riskReward: lv.riskReward,
    invalidation: lv.stopLoss,
    entryZone: direction === "BUY" ? [lv.stopLoss, entry] : [entry, lv.stopLoss],
    stopPips: lv.stopPips,
    evidence: [`Tech+Pattern confluence`, ...evidence].slice(0, 6),
    riskNotes,
  };
}

export function strategyA(
  pair: string,
  barsM15: OhlcvBar[],
  barsM5: OhlcvBar[],
  barsM1: OhlcvBar[] | null | undefined,
  regime: ForexRegimeSnapshot,
): ForexScalpSetup | null {
  if (regime.volatility === "EXTREME_VOLATILITY") return null;
  if (barsM15.length < 15 || barsM5.length < 20) return null;

  const m15 = barsM15[barsM15.length - 1];
  const avgB = avgBody(barsM15, 10);
  if (avgB <= 0) return null;
  const bodySize = bodyOf(m15);
  // Slightly looser impulse threshold so more setups surface
  if (bodySize <= 1.2 * avgB) return null;

  const uW = upperWickOf(m15);
  const lW = lowerWickOf(m15);
  if (uW > bodySize * 1.4 || lW > bodySize * 1.4) return null;

  const direction: ForexScalpDirection = isBull(m15) ? "BUY" : isBear(m15) ? "SELL" : "NONE";
  if (direction === "NONE") return null;
  if (direction === "BUY" && regime.market === "TRENDING_DOWN") return null;
  if (direction === "SELL" && regime.market === "TRENDING_UP") return null;

  const evidence = [`M15 impulse body ${toPips(pair, bodySize).toFixed(1)} pip > 1.2x avg | ${direction}`];
  const riskNotes: string[] = [];

  const m5 = barsM5[barsM5.length - 1];
  const m5Broke = direction === "BUY" ? m5.close > m15.high : m5.close < m15.low;
  const m5WickThrough =
    direction === "BUY"
      ? m5.high > m15.high && m5.close <= m15.high
      : m5.low < m15.low && m5.close >= m15.low;

  if (m5WickThrough && !m5Broke) {
    return {
      strategy: "A",
      direction,
      status: "INVALIDATED",
      strength: 20,
      entry: null,
      stopLoss: null,
      takeProfit: null,
      riskReward: null,
      invalidation: direction === "BUY" ? m15.low : m15.high,
      entryZone: null,
      stopPips: null,
      evidence: [...evidence, "M5 false breakout — huy setup"],
      riskNotes: ["False breakout"],
    };
  }

  if (!m5Broke) {
    // Still provide provisional levels at M15 extreme
    const provisionalEntry = direction === "BUY" ? m15.high : m15.low;
    const lv = levelsFromBias(pair, direction, provisionalEntry, barsM5, 1.25);
    return {
      strategy: "A",
      direction,
      status: "AWAITING_M5_BREAKOUT",
      strength: 42,
      entry: provisionalEntry,
      stopLoss: lv.stopLoss,
      takeProfit: lv.takeProfit,
      riskReward: lv.riskReward,
      invalidation: direction === "BUY" ? m15.low : m15.high,
      entryZone: direction === "BUY" ? [m15.high, m15.high] : [m15.low, m15.low],
      stopPips: lv.stopPips,
      evidence: [...evidence, `Cho M5 close ${direction === "BUY" ? ">" : "<"} M15 extreme — mức tạm tính`],
      riskNotes,
    };
  }

  evidence.push(`M5 breakout close ${fmt(m5.close)}`);
  let status: ForexSetupStatus = "TRIGGERED";
  let entry = m5.close;
  let strength = 68;

  if (barsM1 && barsM1.length >= 10) {
    const zone = direction === "BUY" ? m15.high : m15.low;
    const recent = barsM1.slice(-8);
    const retested = recent.some((b) =>
      direction === "BUY" ? b.low <= zone && b.close >= zone * 0.9999 : b.high >= zone && b.close <= zone * 1.0001,
    );
    const lastM1 = barsM1[barsM1.length - 1];
    const triggerOk =
      direction === "BUY"
        ? isBull(lastM1) || lowerWickOf(lastM1) > bodyOf(lastM1)
        : isBear(lastM1) || upperWickOf(lastM1) > bodyOf(lastM1);
    if (retested && triggerOk) {
      status = "TRIGGERED";
      strength = 86;
      entry = lastM1.close;
      evidence.push("M1 retest + confirm");
    } else {
      status = "AWAITING_M1_RETEST";
      strength = 55;
      evidence.push(retested ? "Cho nen xac nhan M1" : "Cho M1 pullback");
    }
  }

  const atrM5 = atr(barsM5, 14) ?? rangeOf(m5);
  const stopLoss =
    direction === "BUY" ? Math.min(m15.low, entry - 0.5 * atrM5) : Math.max(m15.high, entry + 0.5 * atrM5);
  const risk = Math.abs(entry - stopLoss);
  if (risk <= 0) return null;
  const rr = 1.25;
  const takeProfit = direction === "BUY" ? entry + risk * rr : entry - risk * rr;
  const stopPips = toPips(pair, risk);

  if (regime.volatility === "HIGH_VOLATILITY") {
    riskNotes.push("HIGH_VOLATILITY — giam size");
    strength = Math.round(strength * 0.85);
  }

  return {
    strategy: "A",
    direction,
    status,
    strength,
    entry,
    stopLoss,
    takeProfit,
    riskReward: rr,
    invalidation: stopLoss,
    entryZone: direction === "BUY" ? [entry, stopLoss] : [stopLoss, entry],
    stopPips,
    evidence,
    riskNotes,
  };
}

export function strategyC(
  pair: string,
  barsM15: OhlcvBar[],
  barsM5: OhlcvBar[],
  regime: ForexRegimeSnapshot,
): ForexScalpSetup | null {
  if (regime.volatility === "EXTREME_VOLATILITY") return null;
  if (barsM15.length < 25 || barsM5.length < 15) return null;

  const look = 12;
  const highs = barsM15.map((b) => b.high);
  const lows = barsM15.map((b) => b.low);
  const sliceH = highs.slice(-look);
  const sliceL = lows.slice(-look);
  const mid = Math.floor(look / 2);
  const firstHigh = Math.max(...sliceH.slice(0, mid));
  const secondHigh = Math.max(...sliceH.slice(mid));
  const firstLow = Math.min(...sliceL.slice(0, mid));
  const secondLow = Math.min(...sliceL.slice(mid));

  let trend: "UPTREND" | "DOWNTREND" | "SIDEWAY" = "SIDEWAY";
  if (secondHigh > firstHigh && secondLow > firstLow) trend = "UPTREND";
  else if (secondHigh < firstHigh && secondLow < firstLow) trend = "DOWNTREND";
  if (trend === "SIDEWAY") return null;
  if (trend === "UPTREND" && regime.market === "TRENDING_DOWN") return null;
  if (trend === "DOWNTREND" && regime.market === "TRENDING_UP") return null;

  const candidates = barsM15.slice(-8, -1);
  let sweep: OhlcvBar | null = null;
  for (let i = candidates.length - 1; i >= 0; i--) {
    const c = candidates[i];
    const prior = barsM15.slice(0, barsM15.length - (candidates.length - i));
    if (prior.length < 5) continue;
    const structLow = Math.min(...prior.slice(-8).map((b) => b.low));
    const structHigh = Math.max(...prior.slice(-8).map((b) => b.high));
    if (trend === "UPTREND" && c.low < structLow && c.close > structLow) {
      sweep = c;
      break;
    }
    if (trend === "DOWNTREND" && c.high > structHigh && c.close < structHigh) {
      sweep = c;
      break;
    }
  }
  if (!sweep) return null;

  const rectangle =
    trend === "UPTREND"
      ? { top: Math.min(sweep.open, sweep.close), bottom: sweep.low }
      : { top: sweep.high, bottom: Math.max(sweep.open, sweep.close) };

  const evidence = [`M15 ${trend}: liquidity sweep`, `Rectangle ${fmt(rectangle.bottom)} – ${fmt(rectangle.top)}`];
  const riskNotes: string[] = [];
  const m5 = barsM5[barsM5.length - 1];
  const confirmed = trend === "UPTREND" ? m5.close > rectangle.top : m5.close < rectangle.bottom;
  const invalidated = trend === "UPTREND" ? m5.close < rectangle.bottom : m5.close > rectangle.top;
  const direction: ForexScalpDirection = trend === "UPTREND" ? "BUY" : "SELL";

  if (invalidated) {
    return {
      strategy: "C",
      direction,
      status: "INVALIDATED",
      strength: 15,
      entry: null,
      stopLoss: null,
      takeProfit: null,
      riskReward: null,
      invalidation: trend === "UPTREND" ? rectangle.bottom : rectangle.top,
      entryZone: null,
      stopPips: null,
      rectangle,
      evidence: [...evidence, "M5 invalidation"],
      riskNotes: ["Sweep failed"],
    };
  }

  if (!confirmed) {
    const provisionalEntry = (rectangle.top + rectangle.bottom) / 2;
    const lv = levelsFromBias(pair, direction, provisionalEntry, barsM5, 1.4);
    return {
      strategy: "C",
      direction,
      status: "AWAITING_M5_BREAKOUT",
      strength: 44,
      entry: provisionalEntry,
      stopLoss: trend === "UPTREND" ? sweep.low : sweep.high,
      takeProfit: lv.takeProfit,
      riskReward: lv.riskReward,
      invalidation: trend === "UPTREND" ? rectangle.bottom : rectangle.top,
      entryZone: [rectangle.bottom, rectangle.top],
      stopPips: toPips(pair, Math.abs((trend === "UPTREND" ? sweep.low : sweep.high) - provisionalEntry)),
      rectangle,
      evidence: [...evidence, "Cho M5 confirm rectangle — mức tạm tính"],
      riskNotes,
    };
  }

  const entry = m5.close;
  const stopLoss = trend === "UPTREND" ? sweep.low : sweep.high;
  const risk = Math.abs(entry - stopLoss);
  if (risk <= 0) return null;
  const sr = supportResistance(barsM15, 48);
  let takeProfit: number;
  if (direction === "BUY") {
    const r = sr.resistance.find((x) => x > entry);
    takeProfit = r ?? entry + risk * 1.5;
  } else {
    const s = sr.support.find((x) => x < entry);
    takeProfit = s ?? entry - risk * 1.5;
  }
  const rr = risk > 0 ? Math.abs(takeProfit - entry) / risk : 0;
  const stopPips = toPips(pair, risk);
  if (regime.atrPips != null && stopPips > regime.atrPips * 2.5) {
    riskNotes.push("SL qua rong vs ATR — bo");
    return null;
  }

  evidence.push(`M5 confirm | RR ${rr.toFixed(2)} | SL ${stopPips.toFixed(1)} pip`);
  return {
    strategy: "C",
    direction,
    status: "TRIGGERED",
    strength: clamp(Math.round(55 + Math.min(rr, 2) * 15), 0, 92),
    entry,
    stopLoss,
    takeProfit,
    riskReward: Number(rr.toFixed(2)),
    invalidation: stopLoss,
    entryZone: [Math.min(entry, stopLoss), Math.max(entry, stopLoss)],
    stopPips,
    rectangle,
    evidence,
    riskNotes,
  };
}

export function strategyB(
  _pair: string,
  _barsM5: OhlcvBar[],
  regime: ForexRegimeSnapshot,
): { setup: ForexScalpSetup | null; status: "AVAILABLE" | "ORDER_FLOW_UNAVAILABLE" } {
  if (regime.market !== "RANGING") {
    return { setup: null, status: "ORDER_FLOW_UNAVAILABLE" };
  }
  return {
    status: "ORDER_FLOW_UNAVAILABLE",
    setup: {
      strategy: "B",
      direction: "NONE",
      status: "NO_SETUP",
      strength: 0,
      entry: null,
      stopLoss: null,
      takeProfit: null,
      riskReward: null,
      invalidation: null,
      entryZone: null,
      stopPips: null,
      evidence: [
        "Forex OTC: khong co consolidated tape — Module B yeu cau futures/tick proxy",
        "ORDER_FLOW_UNAVAILABLE",
      ],
      riskNotes: ["Dung Module A/C/Tech cho den khi co order-flow feed"],
    },
  };
}
