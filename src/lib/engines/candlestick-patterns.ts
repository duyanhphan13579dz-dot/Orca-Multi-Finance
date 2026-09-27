import type { OhlcvBar } from "../types";

/**
 * Candlestick pattern engine - aligned with
 * src/lib/vn/candlestick-ruleset.json (VN equities context).
 *
 * Filters applied:
 *  - Prior trend (3-5 bars) for reversal patterns
 *  - Volume vs 20-session average (downgrade if low)
 *  - Confirmation not required for detection, but flagged
 */

export type PatternCategory =
  | "bullish_reversal"
  | "bearish_reversal"
  | "continuation"
  | "neutral";

export type Reliability = "very_high" | "high" | "medium" | "low";

export interface DetectedCandlePattern {
  name: string;
  nameVi: string;
  type: "bullish" | "bearish" | "neutral";
  category: PatternCategory;
  reliability: Reliability;
  /** 0-100 after filters */
  score: number;
  candles: number;
  description: string;
  confirmation: string;
  volumeConfirmed: boolean;
  trendContext: "up" | "down" | "sideways" | "unknown";
  /** Index of last bar of the pattern within the series */
  barIndex: number;
}

type C = {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  body: number;
  range: number;
  upper: number;
  lower: number;
  bull: boolean;
  bear: boolean;
};

function toC(b: OhlcvBar): C {
  const body = Math.abs(b.close - b.open);
  const range = Math.max(b.high - b.low, 1e-12);
  return {
    o: b.open,
    h: b.high,
    l: b.low,
    c: b.close,
    v: b.volume ?? 0,
    body,
    range,
    upper: b.high - Math.max(b.open, b.close),
    lower: Math.min(b.open, b.close) - b.low,
    bull: b.close > b.open,
    bear: b.close < b.open,
  };
}

function mid(x: C): number {
  return (x.o + x.c) / 2;
}

function priorTrend(
  bars: OhlcvBar[],
  endExclusive: number,
  look = 5,
): "up" | "down" | "sideways" | "unknown" {
  if (endExclusive < look + 1) return "unknown";
  const slice = bars.slice(endExclusive - look, endExclusive);
  if (slice.length < 3) return "unknown";
  let up = 0;
  let down = 0;
  for (const b of slice) {
    if (b.close > b.open) up++;
    else if (b.close < b.open) down++;
  }
  const first = slice[0]!;
  const last = slice[slice.length - 1]!;
  const netPct =
    first.close > 0 ? ((last.close - first.close) / first.close) * 100 : 0;
  if (up >= look - 1 || (up >= 3 && down <= 1) || netPct >= 2.5) return "up";
  if (down >= look - 1 || (down >= 3 && up <= 1) || netPct <= -2.5) return "down";
  if (up >= Math.ceil(look * 0.6) && netPct > 0.8) return "up";
  if (down >= Math.ceil(look * 0.6) && netPct < -0.8) return "down";
  return "sideways";
}

function avgVolume(bars: OhlcvBar[], endInclusive: number, n = 20): number {
  const start = Math.max(0, endInclusive - n + 1);
  const slice = bars.slice(start, endInclusive + 1);
  if (!slice.length) return 0;
  return slice.reduce((a, b) => a + (b.volume ?? 0), 0) / slice.length;
}

function avgBody(cs: C[], n = 10): number {
  const slice = cs.slice(-n);
  if (!slice.length) return 1;
  return slice.reduce((a, c) => a + c.body, 0) / slice.length;
}

function nearEqual(a: number, b: number, tolPct = 0.003): boolean {
  const base = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / base <= tolPct;
}

function reliabilityScore(
  base: Reliability,
  volumeOk: boolean,
  trendOk: boolean,
  opts?: { volumeStrong?: boolean; isReversal?: boolean },
): {
  reliability: Reliability;
  score: number;
} {
  const baseScore =
    base === "very_high" ? 92 : base === "high" ? 78 : base === "medium" ? 58 : 36;
  let score = baseScore;
  let reliability = base;
  if (!volumeOk) {
    score -= 18;
    if (reliability === "very_high") reliability = "high";
    else if (reliability === "high") reliability = "medium";
    else if (reliability === "medium") reliability = "low";
  } else if (opts?.volumeStrong) {
    score += 8;
  }
  if (!trendOk) {
    score -= opts?.isReversal ? 18 : 10;
  } else if (opts?.isReversal) {
    score += 6;
  }
  return { reliability, score: Math.max(10, Math.min(100, score)) };
}

function push(
  out: DetectedCandlePattern[],
  p: Omit<DetectedCandlePattern, "score" | "reliability" | "volumeConfirmed"> & {
    baseReliability: Reliability;
    volumeOk: boolean;
    trendOk: boolean;
    volumeStrong?: boolean;
  },
) {
  const isReversal =
    p.category === "bullish_reversal" || p.category === "bearish_reversal";
  const { reliability, score } = reliabilityScore(p.baseReliability, p.volumeOk, p.trendOk, {
    volumeStrong: p.volumeStrong,
    isReversal,
  });
  out.push({
    name: p.name,
    nameVi: p.nameVi,
    type: p.type,
    category: p.category,
    reliability,
    score,
    candles: p.candles,
    description: p.description,
    confirmation: p.confirmation,
    volumeConfirmed: p.volumeOk,
    trendContext: p.trendContext,
    barIndex: p.barIndex,
  });
}

export function detectCandlePatterns(bars: OhlcvBar[]): DetectedCandlePattern[] {
  if (bars.length < 6) return [];
  const cs = bars.map(toC);
  const n = cs.length;
  const i = n - 1;
  const cur = cs[i];
  const p1 = cs[i - 1];
  const p2 = cs[i - 2];
  const p3 = i >= 3 ? cs[i - 3] : null;
  const p4 = i >= 4 ? cs[i - 4] : null;
  const ab = avgBody(cs, 12);
  const avgVol = avgVolume(bars, i, 20);
  const volOk = (idx: number) => {
    const v = bars[idx]?.volume ?? 0;
    return avgVol > 0 ? v >= avgVol * 1.15 : true;
  };
  const trendBefore = (patternLen: number) => priorTrend(bars, n - patternLen, 5);
  const out: DetectedCandlePattern[] = [];

  if (cur.body <= cur.range * 0.12) {
    if (cur.lower >= cur.range * 0.6 && cur.upper <= cur.range * 0.1) {
      const t = trendBefore(1);
      push(out, {
        name: "Dragonfly Doji",
        nameVi: "Dragonfly Doji",
        type: "bullish",
        category: "bullish_reversal",
        baseReliability: "medium",
        candles: 1,
        description: "Open≈Close≈High, bóng dưới dài - lực bán bị hấp thụ về cuối phiên.",
        confirmation: "Nến sau đóng cửa trên đỉnh Dragonfly",
        volumeOk: volOk(i),
        trendOk: t === "down",
        trendContext: t,
        barIndex: i,
      });
    } else if (cur.upper >= cur.range * 0.6 && cur.lower <= cur.range * 0.1) {
      const t = trendBefore(1);
      push(out, {
        name: "Gravestone Doji",
        nameVi: "Gravestone Doji",
        type: "bearish",
        category: "bearish_reversal",
        baseReliability: "medium",
        candles: 1,
        description: "Open≈Close≈Low, bóng trên dài - lực mua bị từ chối tại đỉnh.",
        confirmation: "Nến sau đóng cửa dưới đáy Gravestone",
        volumeOk: volOk(i),
        trendOk: t === "up",
        trendContext: t,
        barIndex: i,
      });
    } else if (cur.upper > cur.body * 1.2 && cur.lower > cur.body * 1.2) {
      push(out, {
        name: "Spinning Top",
        nameVi: "Con quay",
        type: "neutral",
        category: "neutral",
        baseReliability: "low",
        candles: 1,
        description: "Thân nhỏ, bóng hai đầu - do dự tạm thời.",
        confirmation: "Đọc cấu trúc nến kề",
        volumeOk: volOk(i),
        trendOk: true,
        trendContext: trendBefore(1),
        barIndex: i,
      });
    } else {
      push(out, {
        name: "Doji",
        nameVi: "Doji",
        type: "neutral",
        category: "neutral",
        baseReliability: "medium",
        candles: 1,
        description: "Lực mua/bán cân bằng - tín hiệu lưỡng lự.",
        confirmation: "Nến tiếp theo xác định hướng",
        volumeOk: volOk(i),
        trendOk: true,
        trendContext: trendBefore(1),
        barIndex: i,
      });
    }
  }

  if (cur.lower >= cur.body * 2 && cur.upper <= cur.body * 0.5 && cur.body > 0) {
    const t = trendBefore(1);
    if (t === "down" || t === "sideways") {
      push(out, {
        name: "Hammer",
        nameVi: "Búa",
        type: "bullish",
        category: "bullish_reversal",
        baseReliability: "high",
        candles: 1,
        description: "Bóng dưới ≥ 2× thân - lực bán bị hấp thụ sau nhịp giảm.",
        confirmation: "Nến sau đóng cửa trên đỉnh Hammer",
        volumeOk: volOk(i),
        trendOk: t === "down",
        trendContext: t,
        barIndex: i,
      });
    }
    if (t === "up") {
      push(out, {
        name: "Hanging Man",
        nameVi: "Người treo cổ",
        type: "bearish",
        category: "bearish_reversal",
        baseReliability: "medium",
        candles: 1,
        description: "Hình dạng Búa nhưng sau uptrend - cảnh báo sớm áp lực bán.",
        confirmation: "Nến sau đóng cửa dưới đáy Hanging Man",
        volumeOk: volOk(i),
        trendOk: true,
        trendContext: t,
        barIndex: i,
      });
    }
  }

  if (cur.upper >= cur.body * 2 && cur.lower <= cur.body * 0.5 && cur.body > 0) {
    const t = trendBefore(1);
    if (t === "down" || t === "sideways") {
      push(out, {
        name: "Inverted Hammer",
        nameVi: "Búa ngược",
        type: "bullish",
        category: "bullish_reversal",
        baseReliability: "medium",
        candles: 1,
        description: "Bóng trên dài cuối downtrend - lực bán suy yếu.",
        confirmation: "Nến sau tăng trên đỉnh Inverted Hammer",
        volumeOk: volOk(i),
        trendOk: t === "down",
        trendContext: t,
        barIndex: i,
      });
    }
    if (t === "up" || t === "sideways") {
      push(out, {
        name: "Shooting Star",
        nameVi: "Sao băng",
        type: "bearish",
        category: "bearish_reversal",
        baseReliability: "high",
        candles: 1,
        description: "Đẩy giá lên rồi bị kéo xuống sát đáy - từ chối tại vùng cao.",
        confirmation: "Nến sau đóng dưới đáy Sao băng",
        volumeOk: volOk(i),
        trendOk: t === "up",
        trendContext: t,
        barIndex: i,
      });
    }
  }

  if (cur.bull && cur.lower <= cur.range * 0.05 && cur.body >= ab * 1.2) {
    push(out, {
      name: "Bullish Belt Hold",
      nameVi: "Bullish Belt Hold",
      type: "bullish",
      category: "bullish_reversal",
      baseReliability: "medium",
      candles: 1,
      description: "Mở sát đáy phiên, thân dài tăng.",
      confirmation: "Nến sau tiếp tục tăng",
      volumeOk: volOk(i),
      trendOk: trendBefore(1) === "down",
      trendContext: trendBefore(1),
      barIndex: i,
    });
  }
  if (cur.bear && cur.upper <= cur.range * 0.05 && cur.body >= ab * 1.2) {
    push(out, {
      name: "Bearish Belt Hold",
      nameVi: "Bearish Belt Hold",
      type: "bearish",
      category: "bearish_reversal",
      baseReliability: "medium",
      candles: 1,
      description: "Mở sát đỉnh phiên, thân dài giảm.",
      confirmation: "Nến sau tiếp tục giảm",
      volumeOk: volOk(i),
      trendOk: trendBefore(1) === "up",
      trendContext: trendBefore(1),
      barIndex: i,
    });
  }

  if (p1.bear && cur.bull && cur.body > p1.body * 1.05 && cur.c >= p1.o && cur.o <= p1.c) {
    const t = trendBefore(2);
    push(out, {
      name: "Bullish Engulfing",
      nameVi: "Nhấn chìm tăng",
      type: "bullish",
      category: "bullish_reversal",
      baseReliability: "high",
      candles: 2,
      description: "Nến tăng bao trùm thân nến giảm trước.",
      confirmation: "Volume nến 2 tăng",
      volumeOk: volOk(i),
      trendOk: t === "down",
      trendContext: t,
      barIndex: i,
    });
  }
  if (p1.bull && cur.bear && cur.body > p1.body * 1.05 && cur.c <= p1.o && cur.o >= p1.c) {
    const t = trendBefore(2);
    push(out, {
      name: "Bearish Engulfing",
      nameVi: "Nhấn chìm giảm",
      type: "bearish",
      category: "bearish_reversal",
      baseReliability: "high",
      candles: 2,
      description: "Nến giảm bao trùm thân nến tăng trước.",
      confirmation: "Volume nến 2 tăng",
      volumeOk: volOk(i),
      trendOk: t === "up",
      trendContext: t,
      barIndex: i,
    });
  }

  if (p1.bear && p1.body >= ab * 1.1 && cur.bull && cur.o < p1.l && cur.c > mid(p1) && cur.c < p1.o) {
    push(out, {
      name: "Piercing Line",
      nameVi: "Xuyên thấu",
      type: "bullish",
      category: "bullish_reversal",
      baseReliability: "high",
      candles: 2,
      description: "Gap xuống rồi đóng trên 50% thân nến giảm trước.",
      confirmation: "Nến 3 tiếp tục tăng",
      volumeOk: volOk(i),
      trendOk: trendBefore(2) === "down",
      trendContext: trendBefore(2),
      barIndex: i,
    });
  }
  if (p1.bull && p1.body >= ab * 1.1 && cur.bear && cur.o > p1.h && cur.c < mid(p1) && cur.c > p1.o) {
    push(out, {
      name: "Dark Cloud Cover",
      nameVi: "Mây đen che phủ",
      type: "bearish",
      category: "bearish_reversal",
      baseReliability: "high",
      candles: 2,
      description: "Gap lên rồi đóng dưới 50% thân nến tăng trước.",
      confirmation: "Nến 3 tiếp tục giảm",
      volumeOk: volOk(i),
      trendOk: trendBefore(2) === "up",
      trendContext: trendBefore(2),
      barIndex: i,
    });
  }

  if (p1.bear && p1.body >= ab * 1.1 && cur.body < p1.body * 0.55 && cur.c < p1.o && cur.o > p1.c) {
    const isCross = cur.body <= p1.body * 0.15;
    push(out, {
      name: isCross ? "Harami Cross (Bullish)" : "Bullish Harami",
      nameVi: isCross ? "Harami Cross (tăng)" : "Bullish Harami",
      type: "bullish",
      category: "bullish_reversal",
      baseReliability: isCross ? "high" : "medium",
      candles: 2,
      description: isCross ? "Harami Cross tăng." : "Nến nhỏ trong thân nến giảm lớn.",
      confirmation: "Nến 3 tăng trên đỉnh nến 1",
      volumeOk: volOk(i),
      trendOk: trendBefore(2) === "down",
      trendContext: trendBefore(2),
      barIndex: i,
    });
  }
  if (p1.bull && p1.body >= ab * 1.1 && cur.body < p1.body * 0.55 && cur.c > p1.o && cur.o < p1.c) {
    const isCross = cur.body <= p1.body * 0.15;
    push(out, {
      name: isCross ? "Harami Cross (Bearish)" : "Bearish Harami",
      nameVi: isCross ? "Harami Cross (giảm)" : "Bearish Harami",
      type: "bearish",
      category: "bearish_reversal",
      baseReliability: isCross ? "high" : "medium",
      candles: 2,
      description: isCross ? "Harami Cross giảm." : "Nến nhỏ trong thân nến tăng lớn.",
      confirmation: "Nến 3 giảm dưới đáy nến 1",
      volumeOk: volOk(i),
      trendOk: trendBefore(2) === "up",
      trendContext: trendBefore(2),
      barIndex: i,
    });
  }

  if (nearEqual(p1.l, cur.l, 0.004)) {
    push(out, {
      name: "Tweezer Bottom",
      nameVi: "Nhíp đáy",
      type: "bullish",
      category: "bullish_reversal",
      baseReliability: "medium",
      candles: 2,
      description: "Hai đáy gần bằng nhau.",
      confirmation: "Volume nến 2 tăng",
      volumeOk: volOk(i),
      trendOk: trendBefore(2) === "down",
      trendContext: trendBefore(2),
      barIndex: i,
    });
  }
  if (nearEqual(p1.h, cur.h, 0.004)) {
    push(out, {
      name: "Tweezer Top",
      nameVi: "Nhíp đỉnh",
      type: "bearish",
      category: "bearish_reversal",
      baseReliability: "medium",
      candles: 2,
      description: "Hai đỉnh gần bằng nhau.",
      confirmation: "Volume nến 2 tăng",
      volumeOk: volOk(i),
      trendOk: trendBefore(2) === "up",
      trendContext: trendBefore(2),
      barIndex: i,
    });
  }

  if (p1.bear && cur.bull && cur.o > p1.h && cur.body >= ab) {
    push(out, {
      name: "Bullish Kicker",
      nameVi: "Bullish Kicker",
      type: "bullish",
      category: "bullish_reversal",
      baseReliability: "very_high",
      candles: 2,
      description: "Gap tăng mạnh - đảo chiều cực mạnh.",
      confirmation: "Gap còn mở",
      volumeOk: volOk(i),
      trendOk: true,
      trendContext: trendBefore(2),
      barIndex: i,
    });
  }
  if (p1.bull && cur.bear && cur.o < p1.l && cur.body >= ab) {
    push(out, {
      name: "Bearish Kicker",
      nameVi: "Bearish Kicker",
      type: "bearish",
      category: "bearish_reversal",
      baseReliability: "very_high",
      candles: 2,
      description: "Gap giảm mạnh - đảo chiều cực mạnh.",
      confirmation: "Gap còn mở",
      volumeOk: volOk(i),
      trendOk: true,
      trendContext: trendBefore(2),
      barIndex: i,
    });
  }

  if (p2.bear && p2.body >= ab * 1.15 && p1.body <= ab * 0.55 && cur.bull && cur.body >= ab * 0.9 && cur.c > mid(p2)) {
    const isDoji = p1.body <= p1.range * 0.15;
    push(out, {
      name: isDoji ? "Morning Doji Star" : "Morning Star",
      nameVi: isDoji ? "Sao Mai Doji" : "Sao mai",
      type: "bullish",
      category: "bullish_reversal",
      baseReliability: "high",
      candles: 3,
      description: "Giảm mạnh → lưỡng lự → tăng - đảo chiều đáy.",
      confirmation: "Nến 3 đóng trên 50% thân nến 1",
      volumeOk: volOk(i),
      trendOk: trendBefore(3) === "down",
      trendContext: trendBefore(3),
      barIndex: i,
    });
  }
  if (p2.bull && p2.body >= ab * 1.15 && p1.body <= ab * 0.55 && cur.bear && cur.body >= ab * 0.9 && cur.c < mid(p2)) {
    const isDoji = p1.body <= p1.range * 0.15;
    push(out, {
      name: isDoji ? "Evening Doji Star" : "Evening Star",
      nameVi: isDoji ? "Evening Doji Star" : "Sao hôm",
      type: "bearish",
      category: "bearish_reversal",
      baseReliability: "high",
      candles: 3,
      description: "Tăng mạnh → lưỡng lự → giảm - hình thành đỉnh.",
      confirmation: "Nến 3 đóng dưới 50% thân nến 1",
      volumeOk: volOk(i),
      trendOk: trendBefore(3) === "up",
      trendContext: trendBefore(3),
      barIndex: i,
    });
  }

  if (p2.bull && p1.bull && cur.bull && p2.c < p1.c && p1.c < cur.c && p2.body >= ab * 0.7 && p1.body >= ab * 0.7 && cur.body >= ab * 0.7) {
    push(out, {
      name: "Three White Soldiers",
      nameVi: "Ba chàng lính trắng",
      type: "bullish",
      category: "bullish_reversal",
      baseReliability: "high",
      candles: 3,
      description: "Ba nến tăng liên tiếp.",
      confirmation: "Thận trọng nếu RSI quá mua",
      volumeOk: volOk(i) || volOk(i - 1),
      trendOk: true,
      trendContext: trendBefore(3),
      barIndex: i,
    });
  }
  if (p2.bear && p1.bear && cur.bear && p2.c > p1.c && p1.c > cur.c && p2.body >= ab * 0.7 && p1.body >= ab * 0.7 && cur.body >= ab * 0.7) {
    push(out, {
      name: "Three Black Crows",
      nameVi: "Ba con quạ đen",
      type: "bearish",
      category: "bearish_reversal",
      baseReliability: "high",
      candles: 3,
      description: "Ba nến giảm liên tiếp.",
      confirmation: "Thận trọng nếu RSI quá bán",
      volumeOk: volOk(i) || volOk(i - 1),
      trendOk: true,
      trendContext: trendBefore(3),
      barIndex: i,
    });
  }

  if (p2.bear && p2.body >= ab * 1.1 && p1.body < p2.body * 0.55 && p1.c < p2.o && p1.o > p2.c && cur.bull && cur.c > p2.h) {
    push(out, {
      name: "Three Inside Up",
      nameVi: "Three Inside Up",
      type: "bullish",
      category: "bullish_reversal",
      baseReliability: "high",
      candles: 3,
      description: "Bullish Harami + nến 3 xác nhận.",
      confirmation: "Tự xác nhận",
      volumeOk: volOk(i),
      trendOk: trendBefore(3) === "down",
      trendContext: trendBefore(3),
      barIndex: i,
    });
  }
  if (p2.bull && p2.body >= ab * 1.1 && p1.body < p2.body * 0.55 && p1.c > p2.o && p1.o < p2.c && cur.bear && cur.c < p2.l) {
    push(out, {
      name: "Three Inside Down",
      nameVi: "Three Inside Down",
      type: "bearish",
      category: "bearish_reversal",
      baseReliability: "high",
      candles: 3,
      description: "Bearish Harami + nến 3 xác nhận.",
      confirmation: "Tự xác nhận",
      volumeOk: volOk(i),
      trendOk: trendBefore(3) === "up",
      trendContext: trendBefore(3),
      barIndex: i,
    });
  }

  if (p2.bear && p1.bull && p1.body > p2.body * 1.05 && p1.c >= p2.o && p1.o <= p2.c && cur.bull && cur.c > p1.c) {
    push(out, {
      name: "Three Outside Up",
      nameVi: "Three Outside Up",
      type: "bullish",
      category: "bullish_reversal",
      baseReliability: "high",
      candles: 3,
      description: "Bullish Engulfing + nến 3 tiếp tục tăng.",
      confirmation: "Tự xác nhận",
      volumeOk: volOk(i - 1) || volOk(i),
      trendOk: trendBefore(3) === "down",
      trendContext: trendBefore(3),
      barIndex: i,
    });
  }
  if (p2.bull && p1.bear && p1.body > p2.body * 1.05 && p1.c <= p2.o && p1.o >= p2.c && cur.bear && cur.c < p1.c) {
    push(out, {
      name: "Three Outside Down",
      nameVi: "Three Outside Down",
      type: "bearish",
      category: "bearish_reversal",
      baseReliability: "high",
      candles: 3,
      description: "Bearish Engulfing + nến 3 tiếp tục giảm.",
      confirmation: "Tự xác nhận",
      volumeOk: volOk(i - 1) || volOk(i),
      trendOk: trendBefore(3) === "up",
      trendContext: trendBefore(3),
      barIndex: i,
    });
  }

  if (p2.bear && p1.body <= p1.range * 0.15 && p1.h < p2.l && cur.bull && cur.l > p1.h) {
    push(out, {
      name: "Bullish Abandoned Baby",
      nameVi: "Bullish Abandoned Baby",
      type: "bullish",
      category: "bullish_reversal",
      baseReliability: "very_high",
      candles: 3,
      description: "Doji gap xuống, nến 3 gap lên - đảo chiều hiếm và mạnh.",
      confirmation: "Volume tăng",
      volumeOk: volOk(i) || volOk(i - 1),
      trendOk: true,
      trendContext: trendBefore(3),
      barIndex: i,
    });
  }
  if (p2.bull && p1.body <= p1.range * 0.15 && p1.l > p2.h && cur.bear && cur.h < p1.l) {
    push(out, {
      name: "Bearish Abandoned Baby",
      nameVi: "Bearish Abandoned Baby",
      type: "bearish",
      category: "bearish_reversal",
      baseReliability: "very_high",
      candles: 3,
      description: "Doji gap lên, nến 3 gap xuống - đảo chiều hiếm và mạnh.",
      confirmation: "Volume tăng",
      volumeOk: volOk(i) || volOk(i - 1),
      trendOk: true,
      trendContext: trendBefore(3),
      barIndex: i,
    });
  }

  if (p2.bull && p1.bull && p1.l > p2.h && cur.bear && cur.o < p1.c && cur.o > p1.o && cur.c < p1.l && cur.c > p2.h) {
    push(out, {
      name: "Upside Tasuki Gap",
      nameVi: "Gap Tasuki tăng",
      type: "bullish",
      category: "continuation",
      baseReliability: "medium",
      candles: 3,
      description: "Gap tăng rồi nến giảm lấp một phần gap.",
      confirmation: "Gap không bị lấp hoàn toàn",
      volumeOk: volOk(i - 1),
      trendOk: trendBefore(3) === "up",
      trendContext: trendBefore(3),
      barIndex: i,
    });
  }
  if (p2.bear && p1.bear && p1.h < p2.l && cur.bull && cur.o > p1.c && cur.o < p1.o && cur.c > p1.h && cur.c < p2.l) {
    push(out, {
      name: "Downside Tasuki Gap",
      nameVi: "Gap Tasuki giảm",
      type: "bearish",
      category: "continuation",
      baseReliability: "medium",
      candles: 3,
      description: "Gap giảm rồi nến tăng lấp một phần gap.",
      confirmation: "Gap không bị lấp hoàn toàn",
      volumeOk: volOk(i - 1),
      trendOk: trendBefore(3) === "down",
      trendContext: trendBefore(3),
      barIndex: i,
    });
  }

  if (p4 && p3 && n >= 5) {
    const c0 = p4;
    const mids = [p3, p2, p1];
    if (c0.bull && c0.body >= ab * 1.2 && mids.every((m) => m.body < c0.body * 0.7 && m.h <= c0.h && m.l >= c0.l) && mids.filter((m) => m.bear).length >= 2 && cur.bull && cur.c > c0.h) {
      push(out, {
        name: "Rising Three Methods",
        nameVi: "Ba phương pháp tăng",
        type: "bullish",
        category: "continuation",
        baseReliability: "high",
        candles: 5,
        description: "Nến tăng lớn → 3 nến nhỏ nghỉ → nến tăng phá đỉnh.",
        confirmation: "Nến 5 đóng trên đỉnh nến 1",
        volumeOk: volOk(i),
        trendOk: true,
        trendContext: "up",
        barIndex: i,
      });
    }
    if (c0.bear && c0.body >= ab * 1.2 && mids.every((m) => m.body < c0.body * 0.7 && m.h <= c0.h && m.l >= c0.l) && mids.filter((m) => m.bull).length >= 2 && cur.bear && cur.c < c0.l) {
      push(out, {
        name: "Falling Three Methods",
        nameVi: "Ba phương pháp giảm",
        type: "bearish",
        category: "continuation",
        baseReliability: "high",
        candles: 5,
        description: "Nến giảm lớn → 3 nến nhỏ nghỉ → nến giảm phá đáy.",
        confirmation: "Nến 5 đóng dưới đáy nến 1",
        volumeOk: volOk(i),
        trendOk: true,
        trendContext: "down",
        barIndex: i,
      });
    }
    if (c0.bull && c0.body >= ab * 1.2 && p3.bull && p3.l > c0.h && p2.body < c0.body * 0.7 && p1.body < c0.body * 0.7 && p2.h <= Math.max(c0.h, p3.h) && p1.h <= Math.max(c0.h, p3.h) && p2.l >= c0.l && p1.l >= c0.l && cur.bull && cur.body >= ab && cur.c > Math.max(c0.h, p3.h, p2.h, p1.h)) {
      push(out, {
        name: "Mat Hold",
        nameVi: "Mat Hold",
        type: "bullish",
        category: "continuation",
        baseReliability: "high",
        candles: 5,
        description: "Biến thể Rising Three Methods với gap tăng nến 2.",
        confirmation: "Nến 5 đóng đỉnh mới",
        volumeOk: volOk(i),
        trendOk: true,
        trendContext: "up",
        barIndex: i,
      });
    }
  }

  if (p1.bear && cur.bull && nearEqual(cur.o, p1.o, 0.003) && cur.body >= ab * 1.1 && cur.c > p1.h) {
    push(out, {
      name: "Separating Lines",
      nameVi: "Đường phân tách",
      type: "bullish",
      category: "continuation",
      baseReliability: "medium",
      candles: 2,
      description: "Nến giảm rồi nến tăng mở đúng giá mở phiên trước.",
      confirmation: "Nến 2 thân dài",
      volumeOk: volOk(i),
      trendOk: trendBefore(2) === "up",
      trendContext: trendBefore(2),
      barIndex: i,
    });
  }
  if (p1.bull && cur.bear && nearEqual(cur.o, p1.o, 0.003) && cur.body >= ab * 1.1 && cur.c < p1.l) {
    push(out, {
      name: "Separating Lines",
      nameVi: "Đường phân tách",
      type: "bearish",
      category: "continuation",
      baseReliability: "medium",
      candles: 2,
      description: "Nến tăng rồi nến giảm mở đúng giá mở phiên trước.",
      confirmation: "Nến 2 thân dài",
      volumeOk: volOk(i),
      trendOk: trendBefore(2) === "down",
      trendContext: trendBefore(2),
      barIndex: i,
    });
  }

  const byName = new Map<string, DetectedCandlePattern>();
  for (const p of out) {
    const prev = byName.get(p.name);
    if (!prev || p.score > prev.score) byName.set(p.name, p);
  }
  return [...byName.values()].sort((a, b) => b.score - a.score).slice(0, 6);
}

export function toLegacyCandlePatterns(
  patterns: DetectedCandlePattern[],
): import("../types").CandlePattern[] {
  return patterns.map((p) => ({
    name: p.name,
    nameVi: p.nameVi,
    type: p.type,
    reliability:
      p.reliability === "very_high" || p.reliability === "high"
        ? "high"
        : p.reliability === "medium"
          ? "medium"
          : "low",
    description: p.description,
  }));
}
