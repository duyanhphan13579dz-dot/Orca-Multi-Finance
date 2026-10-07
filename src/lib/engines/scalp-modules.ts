import type { OhlcvBar } from "../types";
import { atr, ema, supportResistance } from "../technical";
import type {
  AssetFilterResult,
  AssetTier,
  MarketRegime,
  RegimeSnapshot,
  ScalpAnalyzeInput,
  ScalpDirection,
  ScalpSetup,
  SetupStatus,
  VolatilityRegime,
} from "./scalp-types";

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const bodyOf = (b: OhlcvBar) => Math.abs(b.close - b.open);
const rangeOf = (b: OhlcvBar) => Math.max(b.high - b.low, 1e-12);
const isBull = (b: OhlcvBar) => b.close > b.open;
const isBear = (b: OhlcvBar) => b.close < b.open;
const lowerWickOf = (b: OhlcvBar) => Math.min(b.close, b.open) - b.low;
const upperWickOf = (b: OhlcvBar) => b.high - Math.max(b.close, b.open);

function avgBody(bars: OhlcvBar[], n = 10): number {
  const slice = bars.slice(-n - 1, -1);
  if (!slice.length) return 0;
  return slice.reduce((a, b) => a + bodyOf(b), 0) / slice.length;
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: v >= 100 ? 1 : 4 });

const TIER_A = new Set(["BTCUSDT", "ETHUSDT"]);
const TIER_B_BASES = new Set([
  "BNB", "SOL", "XRP", "ADA", "DOGE", "AVAX", "DOT", "LINK", "MATIC", "POL",
  "LTC", "BCH", "ATOM", "NEAR", "APT", "ARB", "OP", "SUI", "TON", "TRX",
  "UNI", "AAVE", "FIL", "ICP", "ETC", "XLM", "ALGO", "VET", "HBAR", "INJ",
]);

function classifyTier(symbol: string, quoteVolume24h: number | null): AssetTier {
  const sym = symbol.toUpperCase();
  if (TIER_A.has(sym)) return "A";
  const base = sym.replace(/USDT$/, "");
  if (TIER_B_BASES.has(base) && (quoteVolume24h == null || quoteVolume24h >= 15_000_000)) return "B";
  if (quoteVolume24h != null && quoteVolume24h >= 8_000_000) return "C";
  if (quoteVolume24h != null && quoteVolume24h < 2_000_000) return "EXCLUDED";
  return "C";
}

export function runAssetFilter(input: ScalpAnalyzeInput): AssetFilterResult {
  const reasons: string[] = [];
  const tier = classifyTier(input.symbol, input.quoteVolume24h ?? null);
  const dataQualityOk =
    input.barsM15.length >= 40 &&
    input.barsM5.length >= 60 &&
    input.barsM15.every((b) => Number.isFinite(b.close) && b.close > 0);

  if (!dataQualityOk) reasons.push("Thieu du lieu OHLCV lien tuc (M15/M5)");

  const vols = input.barsM5.map((b) => b.volume).filter((v) => v > 0);
  const medVol = median(vols.slice(-40, -1));
  const lastVol = input.barsM5[input.barsM5.length - 1]?.volume ?? 0;
  const volumeRatio = medVol > 0 ? lastVol / medVol : null;
  if (volumeRatio != null && volumeRatio < 0.25) {
    reasons.push(`Volume hien tai thap bat thuong (x${volumeRatio.toFixed(2)} median)`);
  }

  const spreadPct = input.spreadPct;
  const maxSpread = tier === "A" ? 0.08 : tier === "B" ? 0.15 : tier === "C" ? 0.35 : 0.05;
  const spreadOk = spreadPct == null || spreadPct <= maxSpread;
  if (spreadPct != null && !spreadOk) {
    reasons.push(`Spread ${(spreadPct * 100).toFixed(3)}% vuot nguong tier ${tier}`);
  }

  if (tier === "EXCLUDED") reasons.push("Thanh khoan 24h qua mong - loai khoi universe");
  if (input.quoteVolume24h != null && input.quoteVolume24h < 5_000_000 && tier !== "A") {
    reasons.push(`Quote volume 24h $${(input.quoteVolume24h / 1e6).toFixed(1)}M - slipage scalping cao`);
  }

  const eligible =
    tier !== "EXCLUDED" && dataQualityOk && spreadOk && (volumeRatio == null || volumeRatio >= 0.2);
  if (eligible) reasons.push(`Pass filter | tier ${tier}`);

  return { eligible, tier, reasons, spreadOk, volumeRatio, dataQualityOk };
}

export function detectRegime(barsM15: OhlcvBar[]): RegimeSnapshot {
  const evidence: string[] = [];
  const atrV = atr(barsM15, 14);
  const last = barsM15[barsM15.length - 1]?.close ?? 0;
  const atrPct = atrV != null && last > 0 ? (atrV / last) * 100 : null;

  const atrSeries: number[] = [];
  for (let i = 20; i <= barsM15.length; i += 2) {
    const a = atr(barsM15.slice(0, i), 14);
    if (a != null) atrSeries.push(a);
  }
  const medAtr = median(atrSeries);
  const atrRatio = atrV != null && medAtr > 0 ? atrV / medAtr : null;

  let volatility: VolatilityRegime = "NORMAL";
  if (atrRatio != null) {
    if (atrRatio >= 2.2 || (atrPct != null && atrPct >= 2.5)) volatility = "EXTREME_VOLATILITY";
    else if (atrRatio >= 1.45 || (atrPct != null && atrPct >= 1.2)) volatility = "HIGH_VOLATILITY";
    else if (atrRatio <= 0.65 || (atrPct != null && atrPct <= 0.25)) volatility = "LOW_VOLATILITY";
  }
  evidence.push(
    `ATR M15 ${atrV != null ? fmt(atrV) : "?"} (${atrPct?.toFixed(2) ?? "?"}%) | ratio ${atrRatio?.toFixed(2) ?? "?"} -> ${volatility}`,
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

  const ema9a = ema(closes, 9);
  const ema21a = ema(closes, 21);
  const e9 = ema9a[closes.length - 1];
  const e21 = ema21a[closes.length - 1];
  const emaUp = e9 != null && e21 != null && e9 > e21;
  const emaDown = e9 != null && e21 != null && e9 < e21;

  const ret6 = closes.length > 7 ? Math.abs(closes[closes.length - 1] / closes[closes.length - 7] - 1) * 100 : 0;
  let market: MarketRegime = "RANGING";
  if (volatility === "EXTREME_VOLATILITY" && ret6 > 3) market = "CHAOTIC";
  else if ((hh && hl) || (emaUp && !ll)) market = "TRENDING_UP";
  else if ((lh && ll) || (emaDown && !hh)) market = "TRENDING_DOWN";
  else market = "RANGING";

  evidence.push(
    `Cau truc M15: ${hh ? "HH " : ""}${hl ? "HL " : ""}${lh ? "LH " : ""}${ll ? "LL " : ""}| EMA9 ${emaUp ? ">" : emaDown ? "<" : "~"} EMA21 -> ${market}`,
  );

  return { volatility, market, atrPct, atrRatio, evidence };
}

export function strategyA(
  barsM15: OhlcvBar[],
  barsM5: OhlcvBar[],
  barsM1: OhlcvBar[] | null | undefined,
  regime: RegimeSnapshot,
): ScalpSetup | null {
  if (regime.volatility === "EXTREME_VOLATILITY") return null;
  if (barsM15.length < 15 || barsM5.length < 20) return null;

  const m15 = barsM15[barsM15.length - 1];
  const avgB = avgBody(barsM15, 10);
  if (avgB <= 0) return null;

  const bodySize = bodyOf(m15);
  const isImpulse = bodySize > 1.5 * avgB;
  const uW = m15.high - Math.max(m15.close, m15.open);
  const lW = Math.min(m15.close, m15.open) - m15.low;
  const wickOk = uW < bodySize * 1.2 && lW < bodySize * 1.2;

  const vols = barsM15.map((b) => b.volume);
  const medV = median(vols.slice(-12, -1).filter((v) => v > 0));
  const volOk = medV <= 0 || m15.volume >= medV * 0.55;

  if (!isImpulse || !wickOk || !volOk) return null;

  const direction: ScalpDirection = isBull(m15) ? "BUY" : isBear(m15) ? "SELL" : "NONE";
  if (direction === "NONE") return null;
  if (direction === "BUY" && regime.market === "TRENDING_DOWN") return null;
  if (direction === "SELL" && regime.market === "TRENDING_UP") return null;

  const evidence: string[] = [
    `M15 impulse: body ${fmt(bodySize)} > 1.5x avg(${fmt(avgB)}) | ${direction}`,
    `Wick OK | volume ${medV > 0 ? `x${(m15.volume / medV).toFixed(2)} med` : "n/a"}`,
  ];
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
      evidence: [...evidence, "M5 quet 2 dau nhung khong dong cua dut khoat - huy setup"],
      riskNotes: ["Breakout gia tren M5"],
    };
  }

  if (!m5Broke) {
    return {
      strategy: "A",
      direction,
      status: "AWAITING_M5_BREAKOUT",
      strength: 35,
      entry: null,
      stopLoss: direction === "BUY" ? m15.low : m15.high,
      takeProfit: null,
      riskReward: null,
      invalidation: direction === "BUY" ? m15.low : m15.high,
      entryZone: direction === "BUY" ? [m15.high, m15.high * 1.001] : [m15.low * 0.999, m15.low],
      evidence: [
        ...evidence,
        `Cho M5 close ${direction === "BUY" ? ">" : "<"} M15 ${direction === "BUY" ? "high" : "low"} ${fmt(direction === "BUY" ? m15.high : m15.low)}`,
      ],
      riskNotes,
    };
  }

  evidence.push(`M5 breakout confirmed: close ${fmt(m5.close)}`);

  let status: SetupStatus = "TRIGGERED";
  let entry = m5.close;
  let strength = 70;

  if (barsM1 && barsM1.length >= 10) {
    const recentM1 = barsM1.slice(-8);
    const zoneTop = direction === "BUY" ? m15.high : m15.low;
    const retested = recentM1.some((b) =>
      direction === "BUY"
        ? b.low <= zoneTop * 1.0015 && b.close >= zoneTop * 0.998
        : b.high >= zoneTop * 0.9985 && b.close <= zoneTop * 1.002,
    );
    const lastM1 = barsM1[barsM1.length - 1];
    const triggerOk =
      direction === "BUY"
        ? isBull(lastM1) || (lastM1.close > lastM1.open * 0.999 && lowerWickOf(lastM1) > bodyOf(lastM1))
        : isBear(lastM1) || (lastM1.close < lastM1.open * 1.001 && upperWickOf(lastM1) > bodyOf(lastM1));

    if (retested && triggerOk) {
      status = "TRIGGERED";
      strength = 88;
      entry = lastM1.close;
      evidence.push("M1 retest + nen xac nhan - entry trigger");
    } else if (retested) {
      status = "AWAITING_M1_RETEST";
      strength = 55;
      evidence.push("Da retest vung breakout - cho nen xac nhan M1");
    } else {
      status = "AWAITING_M1_RETEST";
      strength = 50;
      evidence.push("M5 da break - cho M1 pullback ve vung breakout");
    }
  } else {
    evidence.push("Khong co M1 - dung M5 close lam proxy entry");
    strength = 62;
  }

  const atrM5 = atr(barsM5, 14) ?? rangeOf(m5);
  const stopLoss =
    direction === "BUY" ? Math.min(m15.low, entry - 0.6 * atrM5) : Math.max(m15.high, entry + 0.6 * atrM5);
  const risk = Math.abs(entry - stopLoss);
  if (risk <= 0) return null;
  const rr = 1.25;
  const takeProfit = direction === "BUY" ? entry + risk * rr : entry - risk * rr;

  if (regime.volatility === "HIGH_VOLATILITY") {
    riskNotes.push("HIGH_VOLATILITY - giam position size theo Risk Engine");
    strength = Math.round(strength * 0.85);
  }
  if (regime.volatility === "LOW_VOLATILITY") {
    riskNotes.push("LOW_VOLATILITY - uu tien breakout ro, tranh entry som");
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
    evidence,
    riskNotes,
  };
}

export function strategyC(barsM15: OhlcvBar[], barsM5: OhlcvBar[], regime: RegimeSnapshot): ScalpSetup | null {
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
    if (trend === "UPTREND") {
      if (c.low < structLow * 0.999 && c.close > structLow) {
        sweep = c;
        break;
      }
    } else {
      if (c.high > structHigh * 1.001 && c.close < structHigh) {
        sweep = c;
        break;
      }
    }
  }
  if (!sweep) return null;

  const rectangle =
    trend === "UPTREND"
      ? { top: Math.min(sweep.open, sweep.close), bottom: sweep.low }
      : { top: sweep.high, bottom: Math.max(sweep.open, sweep.close) };

  const evidence: string[] = [
    `M15 ${trend}: liquidity sweep tai ${fmt(trend === "UPTREND" ? sweep.low : sweep.high)}`,
    `Rectangle ${fmt(rectangle.bottom)} - ${fmt(rectangle.top)}`,
  ];
  const riskNotes: string[] = [];

  const m5 = barsM5[barsM5.length - 1];
  const confirmed = trend === "UPTREND" ? m5.close > rectangle.top : m5.close < rectangle.bottom;
  const invalidated = trend === "UPTREND" ? m5.close < rectangle.bottom : m5.close > rectangle.top;

  if (invalidated) {
    return {
      strategy: "C",
      direction: trend === "UPTREND" ? "BUY" : "SELL",
      status: "INVALIDATED",
      strength: 15,
      entry: null,
      stopLoss: null,
      takeProfit: null,
      riskReward: null,
      invalidation: trend === "UPTREND" ? rectangle.bottom : rectangle.top,
      entryZone: null,
      rectangle,
      evidence: [...evidence, "M5 dong cua pha hong rectangle - invalidation"],
      riskNotes: ["Sweep that bai"],
    };
  }

  if (!confirmed) {
    return {
      strategy: "C",
      direction: trend === "UPTREND" ? "BUY" : "SELL",
      status: "AWAITING_M5_BREAKOUT",
      strength: 40,
      entry: null,
      stopLoss: trend === "UPTREND" ? sweep.low : sweep.high,
      takeProfit: null,
      riskReward: null,
      invalidation: trend === "UPTREND" ? rectangle.bottom : rectangle.top,
      entryZone: [rectangle.bottom, rectangle.top],
      rectangle,
      evidence: [...evidence, `Cho M5 close ${trend === "UPTREND" ? ">" : "<"} rectangle`],
      riskNotes,
    };
  }

  const direction: ScalpDirection = trend === "UPTREND" ? "BUY" : "SELL";
  const entry = m5.close;
  const stopLoss = trend === "UPTREND" ? sweep.low : sweep.high;
  const risk = Math.abs(entry - stopLoss);
  if (risk <= 0) return null;

  const sr = supportResistance(barsM15, 48);
  let takeProfit: number;
  if (direction === "BUY") {
    const r = sr.resistance.find((x) => x > entry * 1.002);
    takeProfit = r ?? entry + risk * 1.5;
  } else {
    const s = sr.support.find((x) => x < entry * 0.998);
    takeProfit = s ?? entry - risk * 1.5;
  }
  const rr = risk > 0 ? Math.abs(takeProfit - entry) / risk : 0;

  const atrM15 = atr(barsM15, 14);
  if (atrM15 != null && risk > atrM15 * 2.2) {
    riskNotes.push(`SL qua rong so voi ATR M15 (${fmt(risk)} > 2.2xATR) - bo setup`);
    return null;
  }

  evidence.push(`M5 confirm close ${fmt(m5.close)} | RR ~ ${rr.toFixed(2)}`);
  if (regime.volatility === "HIGH_VOLATILITY") riskNotes.push("HIGH_VOLATILITY - giam size");

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
    rectangle,
    evidence,
    riskNotes,
  };
}

export function strategyB(
  barsM5: OhlcvBar[],
  regime: RegimeSnapshot,
): { setup: ScalpSetup | null; status: "AVAILABLE" | "ORDER_FLOW_UNAVAILABLE" } {
  if (regime.market !== "RANGING" && regime.market !== "CHAOTIC") {
    return { setup: null, status: "ORDER_FLOW_UNAVAILABLE" };
  }
  if (barsM5.length < 80) return { setup: null, status: "ORDER_FLOW_UNAVAILABLE" };

  const slice = barsM5.slice(-96);
  const lo = Math.min(...slice.map((b) => b.low));
  const hi = Math.max(...slice.map((b) => b.high));
  if (hi <= lo) return { setup: null, status: "ORDER_FLOW_UNAVAILABLE" };

  const bins = 24;
  const step = (hi - lo) / bins;
  const volAt = new Array(bins).fill(0) as number[];
  for (const b of slice) {
    const midP = (b.high + b.low + b.close) / 3;
    const idx = clamp(Math.floor((midP - lo) / step), 0, bins - 1);
    volAt[idx] += b.volume;
  }
  const maxVol = Math.max(...volAt);
  const hvnIdx = volAt.indexOf(maxVol);
  const hvnPrice = lo + (hvnIdx + 0.5) * step;
  const last = slice[slice.length - 1].close;
  const nearHvn = Math.abs(last - hvnPrice) / last < 0.004;

  const evidence = [
    `Volume Profile proxy (OHLCV): HVN ~ ${fmt(hvnPrice)} | range ${fmt(lo)}-${fmt(hi)}`,
    "ORDER FLOW / CVD: khong co tape public API -> khong tao tin hieu gia",
  ];

  if (nearHvn && regime.market === "RANGING") {
    return {
      status: "ORDER_FLOW_UNAVAILABLE",
      setup: {
        strategy: "B",
        direction: "NONE",
        status: "NO_SETUP",
        strength: 25,
        entry: null,
        stopLoss: null,
        takeProfit: null,
        riskReward: null,
        invalidation: null,
        entryZone: null,
        evidence: [...evidence, "Gia dang quanh HVN - cho xac nhan order flow that hoac PA module"],
        riskNotes: ["Module B yeu cau tape/CVD - hien ORDER_FLOW_UNAVAILABLE"],
      },
    };
  }
  return { setup: null, status: "ORDER_FLOW_UNAVAILABLE" };
}
