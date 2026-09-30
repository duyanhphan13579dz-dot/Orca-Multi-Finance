import type { OhlcvBar } from "../types";

export type FlowDirection = "bullish" | "bearish" | "neutral";
export type MarketRegime = "TREND_UP" | "TREND_DOWN" | "RANGE" | "HIGH_VOLATILITY" | "LOW_VOLATILITY" | "TRANSITION";
export type FlowState =
  | "ACCUMULATION_CANDIDATE"
  | "DEMAND_EXPANSION"
  | "BULLISH_CONTINUATION"
  | "BULLISH_PULLBACK"
  | "ABSORPTION_BULLISH"
  | "LIQUIDITY_SWEEP_BULLISH"
  | "DISTRIBUTION_CANDIDATE"
  | "SUPPLY_EXPANSION"
  | "BEARISH_CONTINUATION"
  | "BEARISH_PULLBACK"
  | "ABSORPTION_BEARISH"
  | "LIQUIDITY_SWEEP_BEARISH"
  | "BALANCED"
  | "CONFLICTED"
  | "UNCERTAIN";

export interface MoneyFlowConfig {
  volumePeriod: number;
  rvolHigh: number;
  rvolExtreme: number;
  absorptionSpreadRatio: number;
  swingLength: number;
  equalLevelAtrTolerance: number;
  displacementRatio: number;
}

export const DEFAULT_MONEY_FLOW_CONFIG: MoneyFlowConfig = {
  volumePeriod: 20,
  rvolHigh: 1.5,
  rvolExtreme: 2.5,
  absorptionSpreadRatio: 0.7,
  swingLength: 3,
  equalLevelAtrTolerance: 0.15,
  displacementRatio: 1.8,
};

export interface MoneyFlowAnalysis {
  score: number;
  confidence: number;
  state: FlowState;
  regime: MarketRegime;
  vsa: {
    rvol: number | null;
    clv: number | null;
    effortResult: FlowDirection;
    absorption: FlowDirection | null;
    climax: FlowDirection | null;
    events: string[];
  };
  structure: {
    trend: FlowDirection;
    bos: FlowDirection | null;
    choch: FlowDirection | null;
    mss: FlowDirection | null;
    swingHigh: number | null;
    swingLow: number | null;
  };
  liquidity: {
    sweep: "BUY_SIDE" | "SELL_SIDE" | null;
    nearestBuySide: number | null;
    nearestSellSide: number | null;
    levels: { price: number; type: "BUY_SIDE" | "SELL_SIDE"; strength: number }[];
  };
  smc: {
    displacement: FlowDirection | null;
    fvg: { direction: FlowDirection; low: number; high: number; status: "OPEN" | "FILLED" } | null;
    orderBlock: { direction: FlowDirection; low: number; high: number } | null;
  };
  ict: {
    premiumDiscount: "PREMIUM" | "DISCOUNT" | "EQUILIBRIUM" | "UNKNOWN";
    dealingRange: { high: number; low: number } | null;
  };
}

const clamp = (value: number, min = -100, max = 100) => Math.max(min, Math.min(max, value));
const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function direction(value: number, threshold = 0.08): FlowDirection {
  return value > threshold ? "bullish" : value < -threshold ? "bearish" : "neutral";
}

export function analyzeMoneyFlow(input: OhlcvBar[], config: Partial<MoneyFlowConfig> = {}): MoneyFlowAnalysis | null {
  const cfg = { ...DEFAULT_MONEY_FLOW_CONFIG, ...config };
  const bars = input.filter((bar) => [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite));
  if (bars.length < Math.max(30, cfg.swingLength * 3 + 5)) return null;

  const last = bars.at(-1)!;
  const previous = bars.at(-2)!;
  const recent = bars.slice(-cfg.volumePeriod);
  const spreads = recent.map((bar) => Math.max(bar.high - bar.low, Number.EPSILON));
  const volumes = recent.map((bar) => Math.max(0, bar.volume));
  const avgVolume = average(volumes);
  const avgSpread = average(spreads);
  const rvol = avgVolume > 0 ? last.volume / avgVolume : null;
  const spread = Math.max(last.high - last.low, Number.EPSILON);
  const clv = ((last.close - last.low) - (last.high - last.close)) / spread;
  const result = (last.close - previous.close) / Math.max(previous.close, Number.EPSILON);
  const resultBaseline = average(bars.slice(-Math.min(20, bars.length)).map((bar, index, arr) => index ? Math.abs(bar.close - arr[index - 1]!.close) / Math.max(arr[index - 1]!.close, Number.EPSILON) : 0));
  const effortValue = (rvol ?? 0) > cfg.rvolHigh ? (clv > 0.15 && result > resultBaseline ? 1 : clv < -0.15 && result < -resultBaseline ? -1 : 0) : 0;
  const effortResult = direction(effortValue);

  const lowerWick = Math.min(last.open, last.close) - last.low;
  const upperWick = last.high - Math.max(last.open, last.close);
  const absorption = (rvol ?? 0) >= 1.8 && spread <= avgSpread * cfg.absorptionSpreadRatio
    ? lowerWick > spread * 0.35 && clv > 0 ? "bullish" : upperWick > spread * 0.35 && clv < 0 ? "bearish" : null
    : null;
  const uptrend = bars.at(-6)!.close < previous.close && previous.close < last.close;
  const downtrend = bars.at(-6)!.close > previous.close && previous.close > last.close;
  const climax = (rvol ?? 0) >= cfg.rvolExtreme && spread > avgSpread * 1.4
    ? uptrend && clv < 0.35 ? "bearish" : downtrend && clv > -0.35 ? "bullish" : null
    : null;
  const vsaEvents = [
    effortResult === "bullish" ? "DEMAND_EXPANSION" : effortResult === "bearish" ? "SUPPLY_EXPANSION" : null,
    absorption === "bullish" ? "ABSORPTION_BULLISH" : absorption === "bearish" ? "ABSORPTION_BEARISH" : null,
    climax === "bullish" ? "CLIMAX_DOWN" : climax === "bearish" ? "CLIMAX_UP" : null,
  ].filter((event): event is string => Boolean(event));

  const k = cfg.swingLength;
  const swingHighs: number[] = [];
  const swingLows: number[] = [];
  for (let i = k; i < bars.length - k; i++) {
    const window = bars.slice(i - k, i + k + 1);
    if (bars[i]!.high === Math.max(...window.map((bar) => bar.high))) swingHighs.push(bars[i]!.high);
    if (bars[i]!.low === Math.min(...window.map((bar) => bar.low))) swingLows.push(bars[i]!.low);
  }
  const swingHigh = swingHighs.at(-1) ?? null;
  const swingLow = swingLows.at(-1) ?? null;
  const priorHigh = swingHighs.at(-2) ?? null;
  const priorLow = swingLows.at(-2) ?? null;
  const bos = swingHigh && last.close > swingHigh ? "bullish" : swingLow && last.close < swingLow ? "bearish" : null;
  const priorTrend = priorHigh && priorLow && swingHigh && swingLow
    ? swingHigh > priorHigh && swingLow > priorLow ? "bullish" : swingHigh < priorHigh && swingLow < priorLow ? "bearish" : "neutral"
    : "neutral";
  const choch = bos && priorTrend !== "neutral" && bos !== priorTrend ? bos : null;
  const displacement = spread > median(bars.slice(-20).map((bar) => bar.high - bar.low)) * cfg.displacementRatio && Math.abs(clv) > 0.55 ? direction(last.close - last.open) : null;
  const mss = choch && displacement === choch ? choch : null;

  const atr = average(bars.slice(-14).map((bar, index, arr) => index ? Math.max(bar.high - bar.low, Math.abs(bar.high - arr[index - 1]!.close), Math.abs(bar.low - arr[index - 1]!.close)) : bar.high - bar.low));
  const tolerance = atr * cfg.equalLevelAtrTolerance;
  const levels = [...swingHighs.slice(-8).map((price) => ({ price, type: "BUY_SIDE" as const })), ...swingLows.slice(-8).map((price) => ({ price, type: "SELL_SIDE" as const }))]
    .map((level) => ({ ...level, strength: 50 + Math.min(50, levelsTouchCount(bars, level.price, tolerance) * 10) }));
  const sellSide = levels.filter((level) => level.type === "SELL_SIDE").sort((a, b) => Math.abs(last.close - a.price) - Math.abs(last.close - b.price))[0]?.price ?? null;
  const buySide = levels.filter((level) => level.type === "BUY_SIDE").sort((a, b) => Math.abs(last.close - a.price) - Math.abs(last.close - b.price))[0]?.price ?? null;
  const sweep = sellSide && last.low < sellSide && last.close > sellSide ? "SELL_SIDE" : buySide && last.high > buySide && last.close < buySide ? "BUY_SIDE" : null;

  const fvg = bars.length >= 3 ? last.close > last.open && bars.at(-3)!.high < last.low ? { direction: "bullish" as const, low: bars.at(-3)!.high, high: last.low, status: "OPEN" as const } : last.close < last.open && bars.at(-3)!.low > last.high ? { direction: "bearish" as const, low: last.high, high: bars.at(-3)!.low, status: "OPEN" as const } : null : null;
  const orderBlock = displacement && bars.length >= 2 && displacement === "bullish" && previous.close < previous.open ? { direction: "bullish" as const, low: previous.low, high: previous.high } : displacement === "bearish" && previous.close > previous.open ? { direction: "bearish" as const, low: previous.low, high: previous.high } : null;
  const rangeHigh = Math.max(...bars.slice(-50).map((bar) => bar.high));
  const rangeLow = Math.min(...bars.slice(-50).map((bar) => bar.low));
  const equilibrium = (rangeHigh + rangeLow) / 2;
  const premiumDiscount = last.close > equilibrium + atr * 0.1 ? "PREMIUM" : last.close < equilibrium - atr * 0.1 ? "DISCOUNT" : "EQUILIBRIUM";
  const volatility = average(bars.slice(-10).map((bar) => bar.high - bar.low)) / Math.max(average(bars.slice(-40).map((bar) => bar.high - bar.low)), Number.EPSILON);
  const regime: MarketRegime = volatility > 1.6 ? "HIGH_VOLATILITY" : volatility < 0.65 ? "LOW_VOLATILITY" : priorTrend === "bullish" ? "TREND_UP" : priorTrend === "bearish" ? "TREND_DOWN" : choch ? "TRANSITION" : "RANGE";

  const vsaScore = effortResult === "bullish" ? 25 : effortResult === "bearish" ? -25 : absorption === "bullish" ? 16 : absorption === "bearish" ? -16 : 0;
  const structureScore = bos === "bullish" ? 22 : bos === "bearish" ? -22 : 0;
  const liquidityScore = sweep === "SELL_SIDE" ? 20 : sweep === "BUY_SIDE" ? -20 : 0;
  const smcScore = (displacement === "bullish" ? 15 : displacement === "bearish" ? -15 : 0) + (fvg?.direction === "bullish" ? 8 : fvg?.direction === "bearish" ? -8 : 0);
  const ictScore = premiumDiscount === "DISCOUNT" ? 5 : premiumDiscount === "PREMIUM" ? -5 : 0;
  const score = clamp(vsaScore + structureScore + liquidityScore + smcScore + ictScore);
  const agreement = [effortResult, bos ?? "neutral", displacement ?? "neutral", sweep === "SELL_SIDE" ? "bullish" : sweep === "BUY_SIDE" ? "bearish" : "neutral"].filter((value) => value !== "neutral");
  const confidence = Math.round(Math.max(20, Math.min(95, 45 + agreement.filter((value) => value === (score >= 0 ? "bullish" : "bearish")).length * 12 + (rvol != null ? 8 : 0) + (mss ? 10 : 0))));
  const state: FlowState = sweep === "SELL_SIDE" && (mss === "bullish" || displacement === "bullish") ? "LIQUIDITY_SWEEP_BULLISH" : sweep === "BUY_SIDE" && (mss === "bearish" || displacement === "bearish") ? "LIQUIDITY_SWEEP_BEARISH" : absorption === "bullish" ? "ABSORPTION_BULLISH" : absorption === "bearish" ? "ABSORPTION_BEARISH" : score > 35 ? (bos === "bullish" ? "BULLISH_CONTINUATION" : "DEMAND_EXPANSION") : score < -35 ? (bos === "bearish" ? "BEARISH_CONTINUATION" : "SUPPLY_EXPANSION") : "BALANCED";

  return { score, confidence, state, regime, vsa: { rvol, clv, effortResult, absorption, climax, events: vsaEvents }, structure: { trend: priorTrend, bos, choch, mss, swingHigh, swingLow }, liquidity: { sweep, nearestBuySide: buySide, nearestSellSide: sellSide, levels }, smc: { displacement, fvg, orderBlock }, ict: { premiumDiscount, dealingRange: { high: rangeHigh, low: rangeLow } } };
}

function levelsTouchCount(bars: OhlcvBar[], level: number, tolerance: number) {
  return bars.filter((bar) => Math.abs(bar.high - level) <= tolerance || Math.abs(bar.low - level) <= tolerance).length;
}

