import type { OhlcvBar } from "../types";

/**
 * Candlestick pattern engine — multi-asset (stock / forex / crypto).
 * - Prior trend + volume filters (soft when volume absent, e.g. FX)
 * - Multi-bar recent scan; optional keep only reversals completing in last 2–3 bars
 */

export type PatternCategory =
  | "bullish_reversal"
  | "bearish_reversal"
  | "continuation"
  | "neutral";

export type Reliability = "very_high" | "high" | "medium" | "low";

export type CandleAssetClass = "stock" | "forex" | "crypto" | "commodity";

export interface CandleDetectOpts {
  assetClass?: CandleAssetClass;
  /** How many trailing bar positions to evaluate (1 = last only). Default stock=3. */
  recentBars?: number;
  /** Keep only bullish/bearish reversal patterns (drop continuation/neutral). */
  reversalOnly?: boolean;
  /**
   * Pattern must complete within the last N bars of the series (bar age from end).
   * Default when reversalOnly: 3 (cụm 2–3 nến mới nhất).
   */
  maxAgeBars?: number;
}

export interface DetectedCandlePattern {
  name: string;
  nameVi: string;
  type: "bullish" | "bearish" | "neutral";
  category: PatternCategory;
  reliability: Reliability;
  score: number;
  candles: number;
  description: string;
  confirmation: string;
  volumeConfirmed: boolean;
  trendContext: "up" | "down" | "sideways" | "unknown";
  barIndex: number;
  /** Bars from series end when pattern completed (0 = last closed bar). */
  ageBars?: number;
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
  soft = false,
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
  const netPct = first.close > 0 ? ((last.close - first.close) / first.close) * 100 : 0;
  const strong = soft ? 0.35 : 2.5;
  const mild = soft ? 0.12 : 0.8;
  if (up >= look - 1 || (up >= 3 && down <= 1) || netPct >= strong) return "up";
  if (down >= look - 1 || (down >= 3 && up <= 1) || netPct <= -strong) return "down";
  if (up >= Math.ceil(look * 0.6) && netPct > mild) return "up";
  if (down >= Math.ceil(look * 0.6) && netPct < -mild) return "down";
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

function reliabilityScore(
  base: Reliability,
  volumeOk: boolean,
  trendOk: boolean,
  opts?: { volumeStrong?: boolean; isReversal?: boolean },
): { reliability: Reliability; score: number } {
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
  p: Omit<DetectedCandlePattern, "score" | "reliability" | "volumeConfirmed" | "ageBars"> & {
    baseReliability: Reliability;
    volumeOk: boolean;
    trendOk: boolean;
    volumeStrong?: boolean;
    ageBars?: number;
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
    ageBars: p.ageBars ?? 0,
  });
}

/** Prefer fresher completion; then score. */
export function filterRecentReversals(
  patterns: DetectedCandlePattern[],
  maxAgeBars = 3,
): DetectedCandlePattern[] {
  return patterns
    .filter(
      (p) =>
        (p.category === "bullish_reversal" || p.category === "bearish_reversal") &&
        (p.ageBars ?? 0) <= maxAgeBars &&
        p.candles <= 3,
    )
    .sort((a, b) => (a.ageBars ?? 0) - (b.ageBars ?? 0) || b.score - a.score);
}

export function detectCandlePatterns(
  bars: OhlcvBar[],
  opts: CandleDetectOpts = {},
): DetectedCandlePattern[] {
  if (bars.length < 6) return [];
  const soft =
    opts.assetClass === "forex" ||
    opts.assetClass === "crypto" ||
    opts.assetClass === "commodity";
  const recent = Math.max(1, Math.min(opts.recentBars ?? (soft ? 5 : 3), 8));
  const fullLen = bars.length;
  const all: DetectedCandlePattern[] = [];
  for (let end = 0; end < recent; end++) {
    const sliceEnd = fullLen - end;
    if (sliceEnd < 6) continue;
    const found = detectCandlePatternsAt(bars.slice(0, sliceEnd), soft);
    for (const p of found) {
      all.push({ ...p, ageBars: end });
    }
  }
  const byName = new Map<string, DetectedCandlePattern>();
  for (const p of all) {
    const prev = byName.get(p.name);
    // Prefer higher score; if tie prefer fresher (smaller age)
    if (
      !prev ||
      p.score > prev.score ||
      (p.score === prev.score && (p.ageBars ?? 0) < (prev.ageBars ?? 0))
    ) {
      byName.set(p.name, p);
    }
  }
  let out = [...byName.values()].sort(
    (a, b) => (a.ageBars ?? 0) - (b.ageBars ?? 0) || b.score - a.score,
  );

  if (opts.reversalOnly) {
    const maxAge = opts.maxAgeBars ?? 3;
    out = filterRecentReversals(out, maxAge);
  } else if (opts.maxAgeBars != null) {
    out = out.filter((p) => (p.ageBars ?? 0) <= opts.maxAgeBars!);
  }

  return out.slice(0, 8);
}

function detectCandlePatternsAt(bars: OhlcvBar[], soft: boolean): DetectedCandlePattern[] {
  if (bars.length < 6) return [];
  const cs = bars.map(toC);
  const n = cs.length;
  const i = n - 1;
  const cur = cs[i]!;
  const p1 = cs[i - 1]!;
  const p2 = cs[i - 2]!;
  const ab = avgBody(cs, 12);
  const avgVol = avgVolume(bars, i, 20);
  const volOk = (idx: number) => {
    const v = bars[idx]?.volume ?? 0;
    if (!(avgVol > 0)) return true;
    return soft ? v >= avgVol * 0.9 : v >= avgVol * 1.15;
  };
  const volStrong = (idx: number) => {
    const v = bars[idx]?.volume ?? 0;
    if (!(avgVol > 0)) return soft;
    return v >= avgVol * (soft ? 1.2 : 1.5);
  };
  const trendBefore = (patternLen: number) =>
    priorTrend(bars, n - patternLen, soft ? 6 : 5, soft);
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
        description: "Open≈Close≈High, bóng dưới dài.",
        confirmation: "Nến sau đóng trên đỉnh Dragonfly",
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
        description: "Open≈Close≈Low, bóng trên dài.",
        confirmation: "Nến sau đóng dưới đáy Gravestone",
        volumeOk: volOk(i),
        trendOk: t === "up",
        trendContext: t,
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
        description: "Lực mua/bán cân bằng.",
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
        description: "Bóng dưới ≥ 2× thân — hấp thụ lực bán.",
        confirmation: "Nến sau đóng trên đỉnh Hammer",
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
        description: "Hình Búa sau uptrend — cảnh báo bán.",
        confirmation: "Nến sau đóng dưới đáy",
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
        description: "Bóng trên dài cuối downtrend.",
        confirmation: "Nến sau tăng trên đỉnh",
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
        description: "Từ chối tại vùng cao.",
        confirmation: "Nến sau đóng dưới đáy Sao băng",
        volumeOk: volOk(i),
        trendOk: t === "up",
        trendContext: t,
        barIndex: i,
      });
    }
  }

  if (cur.body >= ab * 1.35 && cur.body >= cur.range * 0.88) {
    const t = trendBefore(1);
    if (cur.bull) {
      push(out, {
        name: "Bullish Marubozu",
        nameVi: "Marubozu tăng",
        type: "bullish",
        category: t === "up" ? "continuation" : "bullish_reversal",
        baseReliability: "high",
        candles: 1,
        description: "Thân dài gần full range — lực mua áp đảo.",
        confirmation: "Nến sau không đâm sâu vào thân",
        volumeOk: volOk(i),
        volumeStrong: volStrong(i),
        trendOk: true,
        trendContext: t,
        barIndex: i,
      });
    } else if (cur.bear) {
      push(out, {
        name: "Bearish Marubozu",
        nameVi: "Marubozu giảm",
        type: "bearish",
        category: t === "down" ? "continuation" : "bearish_reversal",
        baseReliability: "high",
        candles: 1,
        description: "Thân dài gần full range — lực bán áp đảo.",
        confirmation: "Nến sau không đâm sâu vào thân",
        volumeOk: volOk(i),
        volumeStrong: volStrong(i),
        trendOk: true,
        trendContext: t,
        barIndex: i,
      });
    }
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

  if (p2.bear && p2.body >= ab * 1.15 && p1.body <= ab * 0.55 && cur.bull && cur.body >= ab * 0.9 && cur.c > mid(p2)) {
    push(out, {
      name: "Morning Star",
      nameVi: "Sao mai",
      type: "bullish",
      category: "bullish_reversal",
      baseReliability: "high",
      candles: 3,
      description: "Giảm mạnh → lưỡng lự → tăng.",
      confirmation: "Nến 3 đóng trên 50% thân nến 1",
      volumeOk: volOk(i),
      trendOk: trendBefore(3) === "down",
      trendContext: trendBefore(3),
      barIndex: i,
    });
  }
  if (p2.bull && p2.body >= ab * 1.15 && p1.body <= ab * 0.55 && cur.bear && cur.body >= ab * 0.9 && cur.c < mid(p2)) {
    push(out, {
      name: "Evening Star",
      nameVi: "Sao hôm",
      type: "bearish",
      category: "bearish_reversal",
      baseReliability: "high",
      candles: 3,
      description: "Tăng mạnh → lưỡng lự → giảm.",
      confirmation: "Nến 3 đóng dưới 50% thân nến 1",
      volumeOk: volOk(i),
      trendOk: trendBefore(3) === "up",
      trendContext: trendBefore(3),
      barIndex: i,
    });
  }

  if (p2.bull && p1.bull && cur.bull && p2.c < p1.c && p1.c < cur.c) {
    push(out, {
      name: "Three White Soldiers",
      nameVi: "Ba chàng lính trắng",
      type: "bullish",
      category: "continuation",
      baseReliability: "high",
      candles: 3,
      description: "Ba nến tăng liên tiếp.",
      confirmation: "Không bóng trên dài",
      volumeOk: volOk(i),
      trendOk: true,
      trendContext: trendBefore(3),
      barIndex: i,
    });
  }
  if (p2.bear && p1.bear && cur.bear && p2.c > p1.c && p1.c > cur.c) {
    push(out, {
      name: "Three Black Crows",
      nameVi: "Ba con quạ đen",
      type: "bearish",
      category: "continuation",
      baseReliability: "high",
      candles: 3,
      description: "Ba nến giảm liên tiếp.",
      confirmation: "Không bóng dưới dài",
      volumeOk: volOk(i),
      trendOk: true,
      trendContext: trendBefore(3),
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
