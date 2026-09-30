/**
 * Composite trade signal from candle patterns + technical momentum.
 * MUA / BÁN / QUAN SÁT + confidence 0–100.
 */
import type { DetectedCandlePattern } from "./candlestick-patterns";

export type TradeAction = "buy" | "sell" | "watch";

export interface TradeSignal {
  action: TradeAction;
  /** MUA | BÁN | QUAN SÁT */
  actionVi: "MUA" | "BÁN" | "QUAN SÁT";
  /** 0–100 */
  confidence: number;
  /** Directional strength −100…+100 (bull positive) */
  bias: number;
  reasons: string[];
  sources: {
    candleBias: number;
    techBias: number;
    confluence: number;
  };
}

export interface TechSnapshot {
  trendScore?: number | null;
  trendLabel?: string | null;
  rsi14?: number | null;
  macdHistogram?: number | null;
  macdCross?: "bull" | "bear" | null;
  priceAboveSma20?: boolean | null;
  priceAboveSma50?: boolean | null;
  volumeConfirmed?: boolean | null;
}

function ageWeight(ageBars: number | undefined): number {
  const a = ageBars ?? 0;
  if (a <= 0) return 1.15;
  if (a === 1) return 1.0;
  if (a === 2) return 0.85;
  if (a === 3) return 0.7;
  return 0.45;
}

/** Aggregate candle patterns → bias −100…+100 */
export function candleBiasFromPatterns(patterns: DetectedCandlePattern[]): {
  bias: number;
  reasons: string[];
  topBull: DetectedCandlePattern | null;
  topBear: DetectedCandlePattern | null;
} {
  if (!patterns.length) {
    return { bias: 0, reasons: [], topBull: null, topBear: null };
  }

  let bull = 0;
  let bear = 0;
  let topBull: DetectedCandlePattern | null = null;
  let topBear: DetectedCandlePattern | null = null;
  const reasons: string[] = [];

  for (const p of patterns) {
    const w = ageWeight(p.ageBars) * (p.volumeConfirmed ? 1.12 : 0.92);
    const contrib = (p.score / 100) * 40 * w;
    if (p.type === "bullish") {
      bull += contrib;
      if (!topBull || p.score > topBull.score) topBull = p;
    } else if (p.type === "bearish") {
      bear += contrib;
      if (!topBear || p.score > topBear.score) topBear = p;
    }
  }

  const nBull = patterns.filter((p) => p.type === "bullish").length;
  const nBear = patterns.filter((p) => p.type === "bearish").length;
  if (nBull >= 2) bull *= 1.12;
  if (nBear >= 2) bear *= 1.12;

  const raw = bull - bear;
  const bias = Math.max(-100, Math.min(100, raw));

  if (topBull && (topBear == null || topBull.score >= (topBear?.score ?? 0))) {
    reasons.push(
      `Nến ${topBull.nameVi} (${topBull.score}đ${topBull.volumeConfirmed ? ", KL xác nhận" : ""})`,
    );
  } else if (topBear) {
    reasons.push(
      `Nến ${topBear.nameVi} (${topBear.score}đ${topBear.volumeConfirmed ? ", KL xác nhận" : ""})`,
    );
  }
  if (nBull >= 2) reasons.push(`${nBull} mẫu tăng cùng lúc`);
  if (nBear >= 2) reasons.push(`${nBear} mẫu giảm cùng lúc`);

  return { bias, reasons, topBull, topBear };
}

/** Technical snapshot → bias −100…+100 */
export function techBiasFromSnapshot(t: TechSnapshot): { bias: number; reasons: string[] } {
  let bias = 0;
  const reasons: string[] = [];

  if (t.trendScore != null && Number.isFinite(t.trendScore)) {
    bias += (t.trendScore / 3) * 35;
    if (t.trendLabel === "strong-up" || t.trendLabel === "up") {
      reasons.push("Xu hướng kỹ thuật nghiêng tăng");
    } else if (t.trendLabel === "strong-down" || t.trendLabel === "down") {
      reasons.push("Xu hướng kỹ thuật nghiêng giảm");
    }
  }

  if (t.rsi14 != null) {
    if (t.rsi14 >= 70) {
      bias -= 12;
      reasons.push(`RSI ${t.rsi14.toFixed(0)} quá mua`);
    } else if (t.rsi14 <= 30) {
      bias += 12;
      reasons.push(`RSI ${t.rsi14.toFixed(0)} quá bán`);
    } else if (t.rsi14 >= 55) {
      bias += 6;
    } else if (t.rsi14 <= 45) {
      bias -= 6;
    }
  }

  if (t.macdHistogram != null) {
    if (t.macdHistogram > 0) {
      bias += 10;
      reasons.push("MACD histogram dương");
    } else {
      bias -= 10;
      reasons.push("MACD histogram âm");
    }
  }
  if (t.macdCross === "bull") {
    bias += 14;
    reasons.push("MACD cắt lên");
  } else if (t.macdCross === "bear") {
    bias -= 14;
    reasons.push("MACD cắt xuống");
  }

  if (t.priceAboveSma20 === true) bias += 6;
  if (t.priceAboveSma20 === false) bias -= 6;
  if (t.priceAboveSma50 === true) bias += 8;
  if (t.priceAboveSma50 === false) bias -= 8;

  return { bias: Math.max(-100, Math.min(100, bias)), reasons };
}

/**
 * Blend candle + tech into MUA / BÁN / QUAN SÁT.
 */
export function computeTradeSignal(
  patterns: DetectedCandlePattern[],
  tech: TechSnapshot = {},
): TradeSignal {
  const candle = candleBiasFromPatterns(patterns);
  const techB = techBiasFromSnapshot(tech);

  const blended = candle.bias * 0.55 + techB.bias * 0.45;

  let confluence = 0;
  const sameDir =
    (candle.bias > 12 && techB.bias > 8) || (candle.bias < -12 && techB.bias < -8);
  const conflict =
    (candle.bias > 20 && techB.bias < -20) || (candle.bias < -20 && techB.bias > 20);
  if (sameDir) confluence = 12;
  if (conflict) confluence = -18;

  const bias = Math.max(-100, Math.min(100, blended + confluence));

  const reasons = [...candle.reasons, ...techB.reasons].slice(0, 6);

  let confidence = Math.round(Math.min(95, Math.abs(bias) * 0.85 + (sameDir ? 10 : 0)));
  if (conflict) confidence = Math.max(25, confidence - 20);
  if (patterns.some((p) => p.volumeConfirmed)) confidence = Math.min(98, confidence + 5);
  if (patterns.length === 0 && Math.abs(techB.bias) < 25) confidence = Math.min(confidence, 40);

  const BUY_TH = 28;
  const SELL_TH = -28;
  const MIN_CONF = 48;

  let action: TradeAction = "watch";
  if (bias >= BUY_TH && confidence >= MIN_CONF) action = "buy";
  else if (bias <= SELL_TH && confidence >= MIN_CONF) action = "sell";
  else action = "watch";

  if (action === "watch") {
    if (candle.bias >= 40 && candle.topBull && candle.topBull.score >= 70) {
      action = "buy";
      confidence = Math.max(confidence, Math.min(88, candle.topBull.score - 5));
    } else if (candle.bias <= -40 && candle.topBear && candle.topBear.score >= 70) {
      action = "sell";
      confidence = Math.max(confidence, Math.min(88, candle.topBear.score - 5));
    }
  }

  if (action === "watch") {
    reasons.unshift("Chưa đủ xác nhận một chiều");
    confidence = Math.min(confidence, 55);
  } else if (action === "buy") {
    reasons.unshift("Thiên hướng tăng");
  } else {
    reasons.unshift("Thiên hướng giảm");
  }

  const actionVi = action === "buy" ? "MUA" : action === "sell" ? "BÁN" : "QUAN SÁT";

  return {
    action,
    actionVi,
    confidence: Math.max(0, Math.min(100, Math.round(confidence))),
    bias: Math.round(bias),
    reasons: reasons.slice(0, 5),
    sources: {
      candleBias: Math.round(candle.bias),
      techBias: Math.round(techB.bias),
      confluence,
    },
  };
}
