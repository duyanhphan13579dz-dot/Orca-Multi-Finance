import "server-only";
import type { OhlcvBar } from "../types";
import { atr, ema, rsi, supportResistance } from "../technical";
import type { ScalpAnalyzeInput, ScalpSetup, ScalpSignal } from "./scalp-types";
import { detectRegime, runAssetFilter, strategyA, strategyB, strategyC } from "./scalp-modules";

export type {
  AssetTier,
  VolatilityRegime,
  MarketRegime,
  ScalpDirection,
  SetupStatus,
  ScalpSetup,
  AssetFilterResult,
  RegimeSnapshot,
  ScalpSignal,
  ScalpAnalyzeInput,
} from "./scalp-types";

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

function legacyQuant(bars: OhlcvBar[]) {
  const closes = bars.map((b) => b.close);
  const last = closes[closes.length - 1];
  const session = bars.slice(-288);
  let pv = 0;
  let vv = 0;
  for (const b of session) {
    if (b.volume > 0) {
      pv += ((b.high + b.low + b.close) / 3) * b.volume;
      vv += b.volume;
    }
  }
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
  const medWin = vols
    .slice(-101, -1)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const medianVol = medWin.length ? medWin[Math.floor(medWin.length / 2)] : 0;
  const volRatio = medianVol > 0 ? vols[vols.length - 1] / medianVol : null;
  const spike = volRatio != null && volRatio >= 1.8;

  let score = 0;
  const emaUp = ema9 != null && ema21 != null ? ema9 > ema21 : null;
  if (emaUp != null) score += emaUp ? 0.8 : -0.8;
  if (vwap != null) score += last > vwap ? 0.6 : -0.6;
  if (mom3 != null) score += Math.sign(mom3) * clamp(Math.abs(mom3) / 0.35, 0, 1) * 0.7;
  if (rsi7 != null) {
    if (rsi7 > 52 && rsi7 <= 70) score += 0.4;
    else if (rsi7 < 48 && rsi7 >= 30) score -= 0.4;
    else if (rsi7 > 82) score -= 0.5;
    else if (rsi7 < 18) score += 0.5;
  }
  if (spike && mom3 != null) score += Math.sign(mom3) * 0.5;
  score = clamp(score, -3, 3);

  return {
    last,
    vwap,
    vwapDistPct,
    ema9,
    ema21,
    rsi7,
    atr: atrV,
    atrPct,
    momentum: { bars3: mom3, bars6: mom6 },
    volume: { ratioVsMedian: volRatio, spike },
    score: Number(score.toFixed(2)),
    micro: supportResistance(bars.slice(-96), 96),
  };
}

/** Multi-timeframe crypto scalping analysis per the M15->M5->M1 spec. */
export function analyzeScalpMulti(input: ScalpAnalyzeInput): ScalpSignal | null {
  if (input.barsM5.length < 60) return null;

  const filter = runAssetFilter(input);
  const regime = detectRegime(input.barsM15);
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
    activeSetups.push({
      strategy: "A",
      direction: "NONE",
      status: "FILTERED_OUT",
      strength: 0,
      entry: null,
      stopLoss: null,
      takeProfit: null,
      riskReward: null,
      invalidation: null,
      entryZone: null,
      evidence: filter.reasons,
      riskNotes: ["Asset Filter chan - khong mo setup"],
    });
  } else if (regime.market === "CHAOTIC") {
    activeSetups.push({
      strategy: "A",
      direction: "NONE",
      status: "NO_SETUP",
      strength: 0,
      entry: null,
      stopLoss: null,
      takeProfit: null,
      riskReward: null,
      invalidation: null,
      entryZone: null,
      evidence: ["CHAOTIC regime - giam rui ro / khong giao dich theo spec"],
      riskNotes: ["Khoa scalping trong che do hon loan"],
    });
  }

  const ranked = [...activeSetups].sort((x, y) => y.strength - x.strength);
  const primarySetup =
    ranked.find((s) => s.status === "TRIGGERED") ??
    ranked.find((s) => s.status === "AWAITING_M1_RETEST" || s.status === "AWAITING_M5_BREAKOUT") ??
    ranked[0] ??
    null;

  let direction: ScalpSignal["direction"] = "neutral";
  let strength = 0;
  if (
    primarySetup &&
    primarySetup.direction === "BUY" &&
    primarySetup.status !== "INVALIDATED" &&
    primarySetup.status !== "FILTERED_OUT"
  ) {
    direction = "watch-long";
    strength = primarySetup.strength;
  } else if (
    primarySetup &&
    primarySetup.direction === "SELL" &&
    primarySetup.status !== "INVALIDATED" &&
    primarySetup.status !== "FILTERED_OUT"
  ) {
    direction = "watch-short";
    strength = primarySetup.strength;
  } else {
    direction = quant.score >= 1.3 ? "watch-long" : quant.score <= -1.3 ? "watch-short" : "neutral";
    strength = Math.round(clamp(Math.abs(quant.score) / 3, 0, 1) * 100);
  }

  const riskNotes: string[] = [
    ...filter.reasons.filter((r) => !r.startsWith("Pass")),
    ...regime.evidence,
    ...(primarySetup?.riskNotes ?? []),
  ];
  if (input.quoteVolume24h != null && input.quoteVolume24h < 50_000_000) {
    riskNotes.push("Thanh khoan 24h duoi $50M - slipage scalping dang ke");
  }
  if (input.fundingRate != null && Math.abs(input.fundingRate) > 0.0008) {
    riskNotes.push(
      `Funding ${(input.fundingRate * 100).toFixed(4)}% - filter context, khong phai tin hieu vao lenh`,
    );
  }

  const evidence: string[] = [
    `Filter: tier ${filter.tier} | eligible=${filter.eligible}`,
    `Regime: ${regime.market} / ${regime.volatility}`,
    ...(primarySetup?.evidence ?? []).slice(0, 4),
    `Legacy quant score ${quant.score} | EMA9 ${quant.ema9 != null && quant.ema21 != null ? (quant.ema9 > quant.ema21 ? ">" : "<") : "?"} EMA21`,
  ];

  const entryZone =
    primarySetup?.entryZone ??
    (quant.atr != null && direction === "watch-long"
      ? ([quant.last, quant.last - 0.35 * quant.atr] as [number, number])
      : quant.atr != null && direction === "watch-short"
        ? ([quant.last, quant.last + 0.35 * quant.atr] as [number, number])
        : null);

  const invalidation =
    primarySetup?.invalidation ??
    (direction === "watch-long"
      ? Math.min(quant.ema21 ?? quant.last, quant.vwap ?? quant.last) - 0.5 * (quant.atr ?? quant.last * 0.004)
      : direction === "watch-short"
        ? Math.max(quant.ema21 ?? quant.last, quant.vwap ?? quant.last) + 0.5 * (quant.atr ?? quant.last * 0.004)
        : null);

  return {
    timeframe: "M15->M5->M1",
    direction,
    strength,
    score: quant.score,
    last: quant.last,
    vwap: quant.vwap,
    vwapDistPct: quant.vwapDistPct,
    ema9: quant.ema9,
    ema21: quant.ema21,
    rsi7: quant.rsi7,
    atr: quant.atr,
    atrPct: quant.atrPct,
    momentum: quant.momentum,
    volume: quant.volume,
    entryZone,
    invalidation,
    micro: quant.micro,
    riskNotes: [...new Set(riskNotes)].slice(0, 8),
    evidence: evidence.slice(0, 8),
    symbol: input.symbol.toUpperCase(),
    filter,
    regime,
    activeSetups,
    primarySetup,
    moduleBStatus,
    context: {
      fundingRate: input.fundingRate ?? null,
      openInterest: input.openInterest ?? null,
      quoteVolume24h: input.quoteVolume24h ?? null,
    },
  };
}

/** Single-series entry (backward compatible with previous analyzeScalp callers). */
export function analyzeScalp(
  bars: OhlcvBar[],
  opts: { timeframe?: string; quoteVolume24h?: number | null; symbol?: string } = {},
): ScalpSignal | null {
  if (bars.length < 60) return null;
  return analyzeScalpMulti({
    symbol: opts.symbol ?? "UNKNOWN",
    barsM15: bars,
    barsM5: bars,
    barsM1: null,
    quoteVolume24h: opts.quoteVolume24h ?? null,
  });
}
