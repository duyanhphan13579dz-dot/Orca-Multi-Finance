import "server-only";
import type { OhlcvBar } from "../types";
import { atr, ema, rsi, supportResistance } from "../technical";

/**
 * CRYPTO SCALPING INTELLIGENCE ENGINE v2
 * Implements the multi-asset scalping spec:
 *   Market Data → Asset Filter + Market Regime → Strategy A / B / C → Risk notes
 *
 * Module A — Price Action M15 → M5 → M1
 * Module B — Order Flow & Volume Profile (partial; needs tape → ORDER_FLOW_UNAVAILABLE when absent)
 * Module C — Liquidity Sweep & Rectangle M15 → M5
 *
 * Deterministic only. No invented prices. LLM layer (when enabled) only explains.
 */

/* ───────────────────────────── types ───────────────────────────── */

export type AssetTier = "A" | "B" | "C" | "EXCLUDED";
export type VolatilityRegime = "LOW_VOLATILITY" | "NORMAL" | "HIGH_VOLATILITY" | "EXTREME_VOLATILITY";
export type MarketRegime = "TRENDING_UP" | "TRENDING_DOWN" | "RANGING" | "CHAOTIC";
export type ScalpDirection = "BUY" | "SELL" | "NONE";
export type SetupStatus =
  | "ACTIVE"
  | "AWAITING_M5_BREAKOUT"
  | "AWAITING_M1_RETEST"
  | "TRIGGERED"
  | "INVALIDATED"
  | "EXPIRED"
  | "FILTERED_OUT"
  | "NO_SETUP";

export interface ScalpSetup {
  strategy: "A" | "B" | "C";
  direction: ScalpDirection;
  status: SetupStatus;
  strength: number;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskReward: number | null;
  invalidation: number | null;
  entryZone: [number, number] | null;
  rectangle?: { top: number; bottom: number } | null;
  evidence: string[];
  riskNotes: string[];
}

export interface AssetFilterResult {
  eligible: boolean;
  tier: AssetTier;
  reasons: string[];
  spreadOk: boolean;
  volumeRatio: number | null;
  dataQualityOk: boolean;
}

export interface RegimeSnapshot {
  volatility: VolatilityRegime;
  market: MarketRegime;
  atrPct: number | null;
  atrRatio: number | null;
  evidence: string[];
}

export interface ScalpSignal {
  symbol: string;
  timeframe: string;
  last: number;
  direction: "watch-long" | "watch-short" | "neutral";
  strength: number;
  score: number;
  vwap: number | null;
  vwapDistPct: number | null;
  ema9: number | null;
  ema21: number | null;
  rsi7: number | null;
  atr: number | null;
  atrPct: number | null;
  momentum: { bars3: number | null; bars6: number | null };
  volume: { ratioVsMedian: number | null; spike: boolean };
  entryZone: [number, number] | null;
  invalidation: number | null;
  micro: { support: number[]; resistance: number[] };
  riskNotes: string[];
  evidence: string[];
  filter: AssetFilterResult;
  regime: RegimeSnapshot;
  activeSetups: ScalpSetup[];
  primarySetup: ScalpSetup | null;
  moduleBStatus: "AVAILABLE" | "ORDER_FLOW_UNAVAILABLE";
  context: {
    fundingRate: number | null;
    openInterest: number | null;
    quoteVolume24h: number | null;
  };
}

export interface ScalpAnalyzeInput {
  symbol: string;
  barsM15: OhlcvBar[];
  barsM5: OhlcvBar[];
  barsM1?: OhlcvBar[] | null;
  quoteVolume24h?: number | null;
  fundingRate?: number | null;
  openInterest?: number | null;
  spreadPct?: number | null;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const body = (b: OhlcvBar) => Math.abs(b.close - b.open);
const range = (b: OhlcvBar) => Math.max(b.high - b.low, 1e-12);
const isBull = (b: OhlcvBar) => b.close > b.open;
const isBear = (b: OhlcvBar) => b.close < b.open;
const avgBody = (bars: OhlcvBar[], n = 10) => {
  const slice = bars.slice(-n - 1, -1);
  if (!slice.length) return 0;
  return slice.reduce((a, b) => a + body(b), 0) / slice.length;
};
const median = (arr: number[]) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
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

function runAssetFilter(input: ScalpAnalyzeInput): AssetFilterResult {
  const reasons: string[] = [];
  const tier = classifyTier(input.symbol, input.quoteVolume24h ?? null);
  const dataQualityOk =
    input.barsM15.length >= 40 &&
    input.barsM5.length >= 60 &&
    input.barsM15.every((b) => Number.isFinite(b.close) && b.close > 0);
  if (!dataQualityOk) reasons.push("Thiếu dữ liệu OHLCV liên tục (M15/M5)");
  const vols = input.barsM5.map((b) => b.volume).filter((v) => v > 0);
  const medVol = median(vols.slice(-40, -1));
  const lastVol = input.barsM5[input.barsM5.length - 1]?.volume ?? 0;
  const volumeRatio = medVol > 0 ? lastVol / medVol : null;
  if (volumeRatio != null && volumeRatio < 0.25) {
    reasons.push(`Volume hiện tại thấp bất thường (x${volumeRatio.toFixed(2)} median)`);
  }
  const spreadPct = input.spreadPct;
  const maxSpread = tier === "A" ? 0.08 : tier === "B" ? 0.15 : tier === "C" ? 0.35 : 0.05;
  const spreadOk = spreadPct == null || spreadPct <= maxSpread;
  if (spreadPct != null && !spreadOk) {
    reasons.push(`Spread ${(spreadPct * 100).toFixed(3)}% vượt ngưỡng tier ${tier}`);
  }
  if (tier === "EXCLUDED") reasons.push("Thanh khoản 24h quá mỏng — loại khỏi universe");
  if (input.quoteVolume24h != null && input.quoteVolume24h < 5_000_000 && tier !== "A") {
    reasons.push(`Quote volume 24h $${(input.quoteVolume24h / 1e6).toFixed(1)}M — slipage scalping cao`);
  }
  const eligible = tier !== "EXCLUDED" && dataQualityOk && spreadOk && (volumeRatio == null || volumeRatio >= 0.2);
  if (eligible) reasons.push(`Pass filter · tier ${tier}`);
  return { eligible, tier, reasons, spreadOk, volumeRatio, dataQualityOk };
}

function detectRegime(barsM15: OhlcvBar[], barsM5: OhlcvBar[]): RegimeSnapshot {
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
  evidence.push(`ATR M15 ${atrV != null ? fmt(atrV) : "?"} (${atrPct?.toFixed(2) ?? "?"}%) · ratio ${atrRatio?.toFixed(2) ?? "?"} → ${volatility}`);
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
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const e9 = ema9[closes.length - 1];
  const e21 = ema21[closes.length - 1];
  const emaUp = e9 != null && e21 != null && e9 > e21;
  const emaDown = e9 != null && e21 != null && e9 < e21;
  const ret6 = closes.length > 7 ? Math.abs(closes[closes.length - 1] / closes[closes.length - 7] - 1) * 100 : 0;
  let market: MarketRegime = "RANGING";
  if (volatility === "EXTREME_VOLATILITY" && ret6 > 3) market = "CHAOTIC";
  else if ((hh && hl) || (emaUp && !ll)) market = "TRENDING_UP";
  else if ((lh && ll) || (emaDown && !hh)) market = "TRENDING_DOWN";
  else market = "RANGING";
  evidence.push(`Cấu trúc M15: ${hh ? "HH" : ""} ${hl ? "HL" : ""} ${lh ? "LH" : ""} ${ll ? "LL" : ""} · EMA9 ${emaUp ? ">" : emaDown ? "<" : "≈"} EMA21 → ${market}`);
  return { volatility, market, atrPct, atrRatio, evidence };
}

function lowerWickOf(b: OhlcvBar) { return Math.min(b.close, b.open) - b.low; }
function upperWickOf(b: OhlcvBar) { return b.high - Math.max(b.close, b.open); }

function strategyA(barsM15: OhlcvBar[], barsM5: OhlcvBar[], barsM1: OhlcvBar[] | null | undefined, regime: RegimeSnapshot): ScalpSetup | null {
  if (regime.volatility === "EXTREME_VOLATILITY") return null;
  if (barsM15.length < 15 || barsM5.length < 20) return null;
  const m15 = barsM15[barsM15.length - 1];
  const avgB = avgBody(barsM15, 10);
  if (avgB <= 0) return null;
  const bodySize = body(m15);
  const isImpulse = bodySize > 1.5 * avgB;
  const upperWick = m15.high - Math.max(m15.close, m15.open);
  const lowerWick = Math.min(m15.close, m15.open) - m15.low;
  const wickOk = upperWick < bodySize * 1.2 && lowerWick < bodySize * 1.2;
  const vols = barsM15.map((b) => b.volume);
  const medV = median(vols.slice(-12, -1).filter((v) => v > 0));
  const volOk = medV <= 0 || m15.volume >= medV * 0.55;
  if (!isImpulse || !wickOk || !volOk) return null;
  const direction: ScalpDirection = isBull(m15) ? "BUY" : isBear(m15) ? "SELL" : "NONE";
  if (direction === "NONE") return null;
  if (direction === "BUY" && regime.market === "TRENDING_DOWN") return null;
  if (direction === "SELL" && regime.market === "TRENDING_UP") return null;
  const evidence: string[] = [`M15 impulse: body ${fmt(bodySize)} > 1.5× avg(${fmt(avgB)}) · ${direction}`, `Wick OK · volume ${medV > 0 ? `x${(m15.volume / medV).toFixed(2)} med` : "n/a"}`];
  const riskNotes: string[] = [];
  const m5 = barsM5[barsM5.length - 1];
  const m5Broke = direction === "BUY" ? m5.close > m15.high : m5.close < m15.low;
  const m5WickThrough = direction === "BUY" ? m5.high > m15.high && m5.close <= m15.high : m5.low < m15.low && m5.close >= m15.low;
  if (m5WickThrough && !m5Broke) {
    return { strategy: "A", direction, status: "INVALIDATED", strength: 20, entry: null, stopLoss: null, takeProfit: null, riskReward: null, invalidation: direction === "BUY" ? m15.low : m15.high, entryZone: null, evidence: [...evidence, "M5 quét hai đầu nhưng không đóng cửa dứt khoát — setup hủy"], riskNotes: ["Breakout giả trên M5"] };
  }
  if (!m5Broke) {
    return { strategy: "A", direction, status: "AWAITING_M5_BREAKOUT", strength: 35, entry: null, stopLoss: direction === "BUY" ? m15.low : m15.high, takeProfit: null, riskReward: null, invalidation: direction === "BUY" ? m15.low : m15.high, entryZone: direction === "BUY" ? [m15.high, m15.high * 1.001] : [m15.low * 0.999, m15.low], evidence: [...evidence, `Chờ M5 close ${direction === "BUY" ? ">" : "<"} M15 ${direction === "BUY" ? "high" : "low"} ${fmt(direction === "BUY" ? m15.high : m15.low)}`], riskNotes };
  }
  evidence.push(`M5 breakout confirmed: close ${fmt(m5.close)}`);
  let status: SetupStatus = "TRIGGERED";
  let entry = m5.close;
  let strength = 70;
  if (barsM1 && barsM1.length >= 10) {
    const recentM1 = barsM1.slice(-8);
    const zoneTop = direction === "BUY" ? m15.high : m15.low;
    const retested = recentM1.some((b) => direction === "BUY" ? b.low <= zoneTop * 1.0015 && b.close >= zoneTop * 0.998 : b.high >= zoneTop * 0.9985 && b.close <= zoneTop * 1.002);
    const lastM1 = barsM1[barsM1.length - 1];
    const triggerOk = direction === "BUY" ? isBull(lastM1) || (lastM1.close > lastM1.open * 0.999 && lowerWickOf(lastM1) > body(lastM1)) : isBear(lastM1) || (lastM1.close < lastM1.open * 1.001 && upperWickOf(lastM1) > body(lastM1));
    if (retested && triggerOk) { status = "TRIGGERED"; strength = 88; entry = lastM1.close; evidence.push("M1 retest + nến xác nhận — entry trigger"); }
    else if (retested) { status = "AWAITING_M1_RETEST"; strength = 55; evidence.push("Đã retest vùng breakout — chờ nến xác nhận M1"); }
    else { status = "AWAITING_M1_RETEST"; strength = 50; evidence.push("M5 đã break — chờ M1 pullback về vùng breakout"); }
  } else { evidence.push("Không có M1 — dùng M5 close làm proxy entry"); strength = 62; }
  const atrM5 = atr(barsM5, 14) ?? range(m5);
  const stopLoss = direction === "BUY" ? Math.min(m15.low, entry - 0.6 * atrM5) : Math.max(m15.high, entry + 0.6 * atrM5);
  const risk = Math.abs(entry - stopLoss);
  if (risk <= 0) return null;
  const rr = 1.25;
  const takeProfit = direction === "BUY" ? entry + risk * rr : entry - risk * rr;
  if (regime.volatility === "HIGH_VOLATILITY") { riskNotes.push("HIGH_VOLATILITY — giảm position size theo Risk Engine"); strength = Math.round(strength * 0.85); }
  if (regime.volatility === "LOW_VOLATILITY") riskNotes.push("LOW_VOLATILITY — ưu tiên breakout rõ, tránh entry sớm");
  return { strategy: "A", direction, status, strength, entry, stopLoss, takeProfit, riskReward: rr, invalidation: stopLoss, entryZone: direction === "BUY" ? [entry, stopLoss] : [stopLoss, entry], evidence, riskNotes };
}

function strategyC(barsM15: OhlcvBar[], barsM5: OhlcvBar[], regime: RegimeSnapshot): ScalpSetup | null {
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
    if (trend === "UPTREND") { if (c.low < structLow * 0.999 && c.close > structLow) { sweep = c; break; } }
    else { if (c.high > structHigh * 1.001 && c.close < structHigh) { sweep = c; break; } }
  }
  if (!sweep) return null;
  const rectangle = trend === "UPTREND" ? { top: Math.min(sweep.open, sweep.close), bottom: sweep.low } : { top: sweep.high, bottom: Math.max(sweep.open, sweep.close) };
  const evidence: string[] = [`M15 ${trend}: liquidity sweep tại ${fmt(trend === "UPTREND" ? sweep.low : sweep.high)}`, `Rectangle ${fmt(rectangle.bottom)} – ${fmt(rectangle.top)}`];
  const riskNotes: string[] = [];
  const m5 = barsM5[barsM5.length - 1];
  const confirmed = trend === "UPTREND" ? m5.close > rectangle.top : m5.close < rectangle.bottom;
  const invalidated = trend === "UPTREND" ? m5.close < rectangle.bottom : m5.close > rectangle.top;
  if (invalidated) return { strategy: "C", direction: trend === "UPTREND" ? "BUY" : "SELL", status: "INVALIDATED", strength: 15, entry: null, stopLoss: null, takeProfit: null, riskReward: null, invalidation: trend === "UPTREND" ? rectangle.bottom : rectangle.top, entryZone: null, rectangle, evidence: [...evidence, "M5 đóng cửa phá hỏng rectangle — invalidation"], riskNotes: ["Sweep thất bại"] };
  if (!confirmed) return { strategy: "C", direction: trend === "UPTREND" ? "BUY" : "SELL", status: "AWAITING_M5_BREAKOUT", strength: 40, entry: null, stopLoss: trend === "UPTREND" ? sweep.low : sweep.high, takeProfit: null, riskReward: null, invalidation: trend === "UPTREND" ? rectangle.bottom : rectangle.top, entryZone: [rectangle.bottom, rectangle.top], rectangle, evidence: [...evidence, `Chờ M5 close ${trend === "UPTREND" ? ">" : "<"} rectangle`], riskNotes };
  const direction: ScalpDirection = trend === "UPTREND" ? "BUY" : "SELL";
  const entry = m5.close;
  const stopLoss = trend === "UPTREND" ? sweep.low : sweep.high;
  const risk = Math.abs(entry - stopLoss);
  if (risk <= 0) return null;
  const sr = supportResistance(barsM15, 48);
  let takeProfit: number;
  if (direction === "BUY") { const r = sr.resistance.find((x) => x > entry * 1.002); takeProfit = r ?? entry + risk * 1.5; }
  else { const s = sr.support.find((x) => x < entry * 0.998); takeProfit = s ?? entry - risk * 1.5; }
  const rr = risk > 0 ? Math.abs(takeProfit - entry) / risk : 0;
  const atrM15 = atr(barsM15, 14);
  if (atrM15 != null && risk > atrM15 * 2.2) { riskNotes.push(`SL quá rộng so với ATR M15 (${fmt(risk)} > 2.2×ATR) — bỏ setup`); return null; }
  evidence.push(`M5 confirm close ${fmt(m5.close)} · RR ≈ ${rr.toFixed(2)}`);
  if (regime.volatility === "HIGH_VOLATILITY") riskNotes.push("HIGH_VOLATILITY — giảm size");
  return { strategy: "C", direction, status: "TRIGGERED", strength: clamp(Math.round(55 + Math.min(rr, 2) * 15), 0, 92), entry, stopLoss, takeProfit, riskReward: Number(rr.toFixed(2)), invalidation: stopLoss, entryZone: [Math.min(entry, stopLoss), Math.max(entry, stopLoss)], rectangle, evidence, riskNotes };
}

function strategyB(barsM5: OhlcvBar[], regime: RegimeSnapshot): { setup: ScalpSetup | null; status: "AVAILABLE" | "ORDER_FLOW_UNAVAILABLE" } {
  if (regime.market !== "RANGING" && regime.market !== "CHAOTIC") return { setup: null, status: "ORDER_FLOW_UNAVAILABLE" };
  if (barsM5.length < 80) return { setup: null, status: "ORDER_FLOW_UNAVAILABLE" };
  const slice = barsM5.slice(-96);
  const lo = Math.min(...slice.map((b) => b.low));
  const hi = Math.max(...slice.map((b) => b.high));
  if (hi <= lo) return { setup: null, status: "ORDER_FLOW_UNAVAILABLE" };
  const bins = 24;
  const step = (hi - lo) / bins;
  const volAt = new Array(bins).fill(0);
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
  const evidence = [`Volume Profile proxy (OHLCV): HVN ≈ ${fmt(hvnPrice)} · range ${fmt(lo)}–${fmt(hi)}`, "ORDER FLOW / CVD / aggressive delta: không có nguồn tape đáng tin cậy trên public API → không tạo tín hiệu giả"];
  if (nearHvn && regime.market === "RANGING") {
    return { status: "ORDER_FLOW_UNAVAILABLE", setup: { strategy: "B", direction: "NONE", status: "NO_SETUP", strength: 25, entry: null, stopLoss: null, takeProfit: null, riskReward: null, invalidation: null, entryZone: null, evidence: [...evidence, "Giá đang quanh HVN — chờ xác nhận order flow thật hoặc PA module"], riskNotes: ["Module B yêu cầu tape/CVD — hiện ORDER_FLOW_UNAVAILABLE"] } };
  }
  return { setup: null, status: "ORDER_FLOW_UNAVAILABLE" };
}

function legacyQuant(bars: OhlcvBar[]) {
  const closes = bars.map((b) => b.close);
  const last = closes[closes.length - 1];
  const session = bars.slice(-288);
  let pv = 0; let vv = 0;
  for (const b of session) { if (b.volume > 0) { pv += ((b.high + b.low + b.close) / 3) * b.volume; vv += b.volume; } }
  const vwap = vv > 0 ? pv / vv : null;
  const vwapDistPct = vwap ? (last / vwap - 1) * 100 : null;
  const ema9 = ema(closes, 9)[closes.length - 1] ?? null;
  const ema21 = ema(closes, 21)[closes.length - 1] ?? null;
  const rsi7 = rsi(closes, 7)[closes.length - 1] ?? null;
  const atrV = atr(bars, 14);
  const atrPct = atrV != null ? (atrV / last) * 100 : null;
  const mom3 = closes.length > 4 ? (last / closes[closes.length - 4] - 1) * 100 : null;
  const mom6 = closes.length > 7 ? (last / closes[closes.length - 7] - 1) * 100 : null;
  const vols = bars.map((b) => b.volume);
  const medWin = vols.slice(-101, -1).filter((v) => v > 0).sort((a, b) => a - b);
  const medianVol = medWin.length ? medWin[Math.floor(medWin.length / 2)] : 0;
  const volRatio = medianVol > 0 ? vols[vols.length - 1] / medianVol : null;
  const spike = volRatio != null && volRatio >= 1.8;
  let score = 0;
  const emaUp = ema9 != null && ema21 != null ? ema9 > ema21 : null;
  if (emaUp != null) score += emaUp ? 0.8 : -0.8;
  if (vwap != null) score += last > vwap ? 0.6 : -0.6;
  if (mom3 != null) score += Math.sign(mom3) * clamp(Math.abs(mom3) / 0.35, 0, 1) * 0.7;
  if (rsi7 != null) { if (rsi7 > 52 && rsi7 <= 70) score += 0.4; else if (rsi7 < 48 && rsi7 >= 30) score -= 0.4; else if (rsi7 > 82) score -= 0.5; else if (rsi7 < 18) score += 0.5; }
  if (spike && mom3 != null) score += Math.sign(mom3) * 0.5;
  score = clamp(score, -3, 3);
  return { last, vwap, vwapDistPct, ema9, ema21, rsi7, atr: atrV, atrPct, momentum: { bars3: mom3, bars6: mom6 }, volume: { ratioVsMedian: volRatio, spike }, score: Number(score.toFixed(2)), micro: supportResistance(bars.slice(-96), 96) };
}

export function analyzeScalpMulti(input: ScalpAnalyzeInput): ScalpSignal | null {
  if (input.barsM5.length < 60) return null;
  const filter = runAssetFilter(input);
  const regime = detectRegime(input.barsM15, input.barsM5);
  const quant = legacyQuant(input.barsM5.length >= 60 ? input.barsM5 : input.barsM15);
  const activeSetups: ScalpSetup[] = [];
  let moduleBStatus: "AVAILABLE" | "ORDER_FLOW_UNAVAILABLE" = "ORDER_FLOW_UNAVAILABLE";
  if (filter.eligible && regime.market !== "CHAOTIC") {
    if (regime.market === "TRENDING_UP" || regime.market === "TRENDING_DOWN" || regime.market === "RANGING") {
      const a = strategyA(input.barsM15, input.barsM5, input.barsM1, regime);
      if (a) activeSetups.push(a);
      const c = strategyC(input.barsM15, input.barsM5, regime);
      if (c) activeSetups.push(c);
    }
    if (regime.market === "RANGING") {
      const b = strategyB(input.barsM5, regime);
      moduleBStatus = b.status;
      if (b.setup) activeSetups.push(b.setup);
    }
  } else if (!filter.eligible) {
    activeSetups.push({ strategy: "A", direction: "NONE", status: "FILTERED_OUT", strength: 0, entry: null, stopLoss: null, takeProfit: null, riskReward: null, invalidation: null, entryZone: null, evidence: filter.reasons, riskNotes: ["Asset Filter chặn — không mở setup"] });
  } else if (regime.market === "CHAOTIC") {
    activeSetups.push({ strategy: "A", direction: "NONE", status: "NO_SETUP", strength: 0, entry: null, stopLoss: null, takeProfit: null, riskReward: null, invalidation: null, entryZone: null, evidence: ["CHAOTIC regime — giảm rủi ro / không giao dịch theo spec"], riskNotes: ["Khóa scalping trong chế độ hỗn loạn"] });
  }
  const ranked = [...activeSetups].sort((x, y) => y.strength - x.strength);
  const primarySetup = ranked.find((s) => s.status === "TRIGGERED") ?? ranked.find((s) => s.status === "AWAITING_M1_RETEST" || s.status === "AWAITING_M5_BREAKOUT") ?? ranked[0] ?? null;
  let direction: ScalpSignal["direction"] = "neutral";
  let strength = 0;
  if (primarySetup && primarySetup.direction === "BUY" && primarySetup.status !== "INVALIDATED" && primarySetup.status !== "FILTERED_OUT") { direction = "watch-long"; strength = primarySetup.strength; }
  else if (primarySetup && primarySetup.direction === "SELL" && primarySetup.status !== "INVALIDATED" && primarySetup.status !== "FILTERED_OUT") { direction = "watch-short"; strength = primarySetup.strength; }
  else { direction = quant.score >= 1.3 ? "watch-long" : quant.score <= -1.3 ? "watch-short" : "neutral"; strength = Math.round(clamp(Math.abs(quant.score) / 3, 0, 1) * 100); }
  const riskNotes: string[] = [...filter.reasons.filter((r) => !r.startsWith("Pass")), ...regime.evidence, ...(primarySetup?.riskNotes ?? [])];
  if (input.quoteVolume24h != null && input.quoteVolume24h < 50_000_000) riskNotes.push("Thanh khoản 24h dưới $50M — slipage scalping đáng kể");
  if (input.fundingRate != null && Math.abs(input.fundingRate) > 0.0008) riskNotes.push(`Funding ${(input.fundingRate * 100).toFixed(4)}% — filter context, không phải tín hiệu vào lệnh`);
  const evidence: string[] = [`Filter: tier ${filter.tier} · eligible=${filter.eligible}`, `Regime: ${regime.market} / ${regime.volatility}`, ...(primarySetup?.evidence ?? []).slice(0, 4), `Legacy quant score ${quant.score} · EMA9 ${quant.ema9 != null && quant.ema21 != null ? (quant.ema9 > quant.ema21 ? ">" : "<") : "?"} EMA21`];
  const entryZone = primarySetup?.entryZone ?? (quant.atr != null && direction === "watch-long" ? [quant.last, quant.last - 0.35 * quant.atr] : quant.atr != null && direction === "watch-short" ? [quant.last, quant.last + 0.35 * quant.atr] : null);
  const invalidation = primarySetup?.invalidation ?? (direction === "watch-long" ? Math.min(quant.ema21 ?? quant.last, quant.vwap ?? quant.last) - 0.5 * (quant.atr ?? quant.last * 0.004) : direction === "watch-short" ? Math.max(quant.ema21 ?? quant.last, quant.vwap ?? quant.last) + 0.5 * (quant.atr ?? quant.last * 0.004) : null);
  return {
    symbol: input.symbol.toUpperCase(), timeframe: "M15→M5→M1", last: quant.last, direction, strength, score: quant.score,
    vwap: quant.vwap, vwapDistPct: quant.vwapDistPct, ema9: quant.ema9, ema21: quant.ema21, rsi7: quant.rsi7, atr: quant.atr, atrPct: quant.atrPct,
    momentum: quant.momentum, volume: quant.volume, entryZone, invalidation, micro: quant.micro,
    riskNotes: [...new Set(riskNotes)].slice(0, 8), evidence: evidence.slice(0, 8),
    filter, regime, activeSetups, primarySetup, moduleBStatus,
    context: { fundingRate: input.fundingRate ?? null, openInterest: input.openInterest ?? null, quoteVolume24h: input.quoteVolume24h ?? null },
  };
}

export function analyzeScalp(bars: OhlcvBar[], opts: { timeframe?: string; quoteVolume24h?: number | null; symbol?: string } = {}): ScalpSignal | null {
  if (bars.length < 60) return null;
  return analyzeScalpMulti({ symbol: opts.symbol ?? "UNKNOWN", barsM15: bars, barsM5: bars, barsM1: null, quoteVolume24h: opts.quoteVolume24h ?? null });
}
