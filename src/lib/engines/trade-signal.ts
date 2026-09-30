/**
 * Composite trade signal — tối ưu độ chính xác, giảm nhiễu.
 * MUA / BÁN chỉ khi nến + kỹ thuật đồng thuận (hoặc nến đảo chiều rất mạnh + volume).
 * Còn lại → QUAN SÁT.
 */
import type { DetectedCandlePattern } from "./candlestick-patterns";

export type TradeAction = "buy" | "sell" | "watch";

export interface TradeSignal {
  action: TradeAction;
  actionVi: "MUA" | "BÁN" | "QUAN SÁT";
  /** 0–100 — chỉ cao khi có xác nhận */
  confidence: number;
  /** −100…+100 */
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

/** Ngưỡng siết — giảm false positive */
const MIN_PATTERN_SCORE = 58;
const MAX_AGE_BARS = 3;
const BUY_BIAS = 38;
const SELL_BIAS = -38;
const MIN_CONF_ACTION = 58;
const MIN_CONF_SOFT = 52;

function ageWeight(ageBars: number | undefined): number {
  const a = ageBars ?? 99;
  if (a <= 0) return 1.2;
  if (a === 1) return 1.0;
  if (a === 2) return 0.75;
  if (a === 3) return 0.55;
  return 0.25;
}

function reliabilityMult(r: DetectedCandlePattern["reliability"]): number {
  if (r === "very_high") return 1.15;
  if (r === "high") return 1.05;
  if (r === "medium") return 0.9;
  return 0.7;
}

/** Lọc nhiễu: bỏ pattern yếu / cũ / trung tính */
export function filterQualityPatterns(
  patterns: DetectedCandlePattern[],
): DetectedCandlePattern[] {
  return patterns.filter((p) => {
    if (p.type === "neutral") return false;
    if (p.score < MIN_PATTERN_SCORE) return false;
    if ((p.ageBars ?? 99) > MAX_AGE_BARS) return false;
    if (p.category === "continuation" && !p.volumeConfirmed && p.score < 70) return false;
    return true;
  });
}

export function candleBiasFromPatterns(patterns: DetectedCandlePattern[]): {
  bias: number;
  reasons: string[];
  topBull: DetectedCandlePattern | null;
  topBear: DetectedCandlePattern | null;
  qualityCount: number;
} {
  const quality = filterQualityPatterns(patterns);
  if (!quality.length) {
    return { bias: 0, reasons: [], topBull: null, topBear: null, qualityCount: 0 };
  }

  let bull = 0;
  let bear = 0;
  let topBull: DetectedCandlePattern | null = null;
  let topBear: DetectedCandlePattern | null = null;

  for (const p of quality) {
    const w =
      ageWeight(p.ageBars) *
      (p.volumeConfirmed ? 1.18 : 0.82) *
      reliabilityMult(p.reliability);
    const isRev =
      p.category === "bullish_reversal" || p.category === "bearish_reversal";
    const base = (p.score / 100) * (isRev ? 42 : 28) * w;
    if (p.type === "bullish") {
      bull += base;
      if (
        !topBull ||
        p.score > topBull.score ||
        (p.score === topBull.score && (p.ageBars ?? 9) < (topBull.ageBars ?? 9))
      )
        topBull = p;
    } else if (p.type === "bearish") {
      bear += base;
      if (
        !topBear ||
        p.score > topBear.score ||
        (p.score === topBear.score && (p.ageBars ?? 9) < (topBear.ageBars ?? 9))
      )
        topBear = p;
    }
  }

  const nBull = quality.filter((p) => p.type === "bullish").length;
  const nBear = quality.filter((p) => p.type === "bearish").length;

  if (nBull >= 2 && nBear === 0) bull *= 1.1;
  if (nBear >= 2 && nBull === 0) bear *= 1.1;
  if (nBull > 0 && nBear > 0) {
    const cancel = Math.min(bull, bear) * 0.85;
    bull = Math.max(0, bull - cancel);
    bear = Math.max(0, bear - cancel);
  }

  const bias = Math.max(-100, Math.min(100, bull - bear));
  const reasons: string[] = [];

  const top =
    topBull && topBear
      ? topBull.score >= topBear.score
        ? topBull
        : topBear
      : (topBull ?? topBear);
  if (top) {
    reasons.push(
      `Nến ${top.nameVi} (${top.score}đ${top.volumeConfirmed ? ", KL✓" : ""}${top.ageBars === 0 ? ", mới" : ""})`,
    );
  }
  if (nBull >= 2 && nBear === 0) reasons.push(`${nBull} mẫu tăng chất lượng`);
  if (nBear >= 2 && nBull === 0) reasons.push(`${nBear} mẫu giảm chất lượng`);
  if (nBull > 0 && nBear > 0) reasons.push("Mẫu nến hai chiều — giảm trọng số");

  return { bias, reasons, topBull, topBear, qualityCount: quality.length };
}

export function techBiasFromSnapshot(t: TechSnapshot): { bias: number; reasons: string[] } {
  let bias = 0;
  const reasons: string[] = [];

  if (t.trendScore != null && Number.isFinite(t.trendScore)) {
    if (Math.abs(t.trendScore) >= 0.75) {
      bias += (t.trendScore / 3) * 32;
      if (t.trendLabel === "strong-up" || t.trendLabel === "up") {
        reasons.push("Xu hướng KT nghiêng tăng");
      } else if (t.trendLabel === "strong-down" || t.trendLabel === "down") {
        reasons.push("Xu hướng KT nghiêng giảm");
      }
    }
  }

  if (t.rsi14 != null) {
    if (t.rsi14 >= 72) {
      bias -= 14;
      reasons.push(`RSI ${t.rsi14.toFixed(0)} quá mua`);
    } else if (t.rsi14 <= 28) {
      bias += 14;
      reasons.push(`RSI ${t.rsi14.toFixed(0)} quá bán`);
    } else if (t.rsi14 >= 58) {
      bias += 5;
    } else if (t.rsi14 <= 42) {
      bias -= 5;
    }
  }

  if (t.macdHistogram != null) {
    const absH = Math.abs(t.macdHistogram);
    if (absH > 1e-8) {
      const scale = Math.min(1, absH * 50);
      if (t.macdHistogram > 0) {
        bias += 9 * scale;
        if (scale > 0.3) reasons.push("MACD hist dương");
      } else {
        bias -= 9 * scale;
        if (scale > 0.3) reasons.push("MACD hist âm");
      }
    }
  }

  if (t.macdCross === "bull") {
    bias += 12;
    reasons.push("MACD cắt lên");
  } else if (t.macdCross === "bear") {
    bias -= 12;
    reasons.push("MACD cắt xuống");
  }

  if (t.priceAboveSma20 === true && t.priceAboveSma50 === true) {
    bias += 10;
  } else if (t.priceAboveSma20 === false && t.priceAboveSma50 === false) {
    bias -= 10;
  }

  return { bias: Math.max(-100, Math.min(100, bias)), reasons };
}

function isSideways(t: TechSnapshot): boolean {
  return t.trendLabel === "sideways" || (t.trendScore != null && Math.abs(t.trendScore) < 0.5);
}

export function computeTradeSignal(
  patterns: DetectedCandlePattern[],
  tech: TechSnapshot = {},
): TradeSignal {
  const candle = candleBiasFromPatterns(patterns);
  const techB = techBiasFromSnapshot(tech);

  let blended = candle.bias * 0.5 + techB.bias * 0.5;

  const sameDir =
    (candle.bias >= 18 && techB.bias >= 12) || (candle.bias <= -18 && techB.bias <= -12);
  const softAgree =
    (candle.bias >= 10 && techB.bias >= 5) || (candle.bias <= -10 && techB.bias <= -5);
  const conflict =
    (candle.bias >= 18 && techB.bias <= -15) || (candle.bias <= -18 && techB.bias >= 15);

  let confluence = 0;
  if (sameDir) confluence = 14;
  else if (softAgree) confluence = 6;
  if (conflict) confluence = -22;

  if (isSideways(tech)) {
    const strongRev =
      (candle.topBull && candle.topBull.score >= 75 && candle.topBull.volumeConfirmed) ||
      (candle.topBear && candle.topBear.score >= 75 && candle.topBear.volumeConfirmed);
    if (!strongRev) {
      blended *= 0.55;
      confluence -= 8;
    }
  }

  const bias = Math.max(-100, Math.min(100, blended + confluence));
  const reasons = [...candle.reasons, ...techB.reasons].slice(0, 6);

  let confidence = Math.round(Math.min(92, Math.abs(bias) * 0.72));
  if (sameDir) confidence += 12;
  else if (softAgree) confidence += 5;
  if (conflict) confidence = Math.max(18, confidence - 28);

  const hasVol = patterns.some(
    (p) =>
      p.volumeConfirmed && p.score >= MIN_PATTERN_SCORE && (p.ageBars ?? 99) <= MAX_AGE_BARS,
  );
  if (hasVol) confidence = Math.min(96, confidence + 6);
  else confidence = Math.min(confidence, 72);

  if (candle.qualityCount === 0) confidence = Math.min(confidence, 50);
  if (candle.qualityCount >= 2 && sameDir) confidence = Math.min(96, confidence + 6);

  if (tech.rsi14 != null) {
    if (bias > 0 && tech.rsi14 >= 75) confidence = Math.max(20, confidence - 18);
    if (bias < 0 && tech.rsi14 <= 25) confidence = Math.max(20, confidence - 18);
  }

  let action: TradeAction = "watch";

  const hardBuy =
    bias >= BUY_BIAS && confidence >= MIN_CONF_ACTION && (sameDir || softAgree);
  const hardSell =
    bias <= SELL_BIAS && confidence >= MIN_CONF_ACTION && (sameDir || softAgree);

  const softBuy =
    !conflict &&
    candle.bias >= 45 &&
    candle.topBull != null &&
    candle.topBull.score >= 78 &&
    candle.topBull.volumeConfirmed &&
    (candle.topBull.ageBars ?? 9) <= 2 &&
    confidence >= MIN_CONF_SOFT;

  const softSell =
    !conflict &&
    candle.bias <= -45 &&
    candle.topBear != null &&
    candle.topBear.score >= 78 &&
    candle.topBear.volumeConfirmed &&
    (candle.topBear.ageBars ?? 9) <= 2 &&
    confidence >= MIN_CONF_SOFT;

  if (hardBuy || softBuy) {
    action = "buy";
    if (softBuy && !hardBuy) {
      confidence = Math.max(confidence, Math.min(85, (candle.topBull?.score ?? 70) - 4));
    }
  } else if (hardSell || softSell) {
    action = "sell";
    if (softSell && !hardSell) {
      confidence = Math.max(confidence, Math.min(85, (candle.topBear?.score ?? 70) - 4));
    }
  }

  if (conflict) {
    action = "watch";
    confidence = Math.min(confidence, 42);
  }

  if (action === "watch") {
    if (!reasons.some((r) => r.includes("hai chiều") || r.includes("Chưa đủ") || r.includes("xung đột"))) {
      reasons.unshift(
        conflict ? "Nến và KT xung đột — ưu tiên quan sát" : "Chưa đủ xác nhận một chiều",
      );
    }
    confidence = Math.min(confidence, 55);
  } else if (action === "buy") {
    reasons.unshift(sameDir ? "Đồng thuận tăng (nến + KT)" : "Thiên hướng tăng");
  } else {
    reasons.unshift(sameDir ? "Đồng thuận giảm (nến + KT)" : "Thiên hướng giảm");
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
