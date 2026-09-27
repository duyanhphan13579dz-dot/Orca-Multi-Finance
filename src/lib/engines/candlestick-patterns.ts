import type { OhlcvBar } from "../types";

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
  score: number;
  candles: number;
  description: string;
  confirmation: string;
  volumeConfirmed: boolean;
  trendContext: "up" | "down" | "sideways" | "unknown";
  barIndex: number;
}

/** Temporary stub so production builds resolve the import; full engine follows. */
export function detectCandlePatterns(_bars: OhlcvBar[]): DetectedCandlePattern[] {
  return [];
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
