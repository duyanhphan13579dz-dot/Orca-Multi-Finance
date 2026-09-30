/**
 * Multi-timeframe bias engine — aggregates structure/SMC/VSA reads across TFs.
 * Pure deterministic; no provider calls. Caller supplies OHLCV per timeframe.
 * Works with money-flow v1 and v2.
 */
import type { OhlcvBar } from "../types";
import { analyzeMoneyFlow, type FlowDirection, type MoneyFlowAnalysis } from "./money-flow";

export type MtfBiasDirection = "bullish" | "bearish" | "neutral";

export interface MtfTimeframeRead {
  timeframe: string;
  weight: number;
  bias: MtfBiasDirection;
  confidence: number;
  trend: FlowDirection;
  bos: FlowDirection | null;
  choch: FlowDirection | null;
  mss: FlowDirection | null;
  premiumDiscount: "PREMIUM" | "DISCOUNT" | "EQUILIBRIUM" | "UNKNOWN";
  state: string;
  score: number;
  analysis: MoneyFlowAnalysis | null;
}

export interface MtfBiasResult {
  bias: MtfBiasDirection;
  /** 0–100 */
  confidence: number;
  /** -100 … +100 weighted score */
  score: number;
  alignment: "aligned_bull" | "aligned_bear" | "mixed" | "insufficient";
  summary: string;
  timeframes: MtfTimeframeRead[];
  htfBias: MtfBiasDirection;
  htfTimeframe: string | null;
}

/** Default weights: higher TF dominates. */
export const DEFAULT_MTF_WEIGHTS: Record<string, number> = {
  "12M": 5,
  "1M": 4.5,
  "1w": 4,
  "1d": 3.5,
  "12h": 2.8,
  "6h": 2.5,
  "4h": 2.2,
  "2h": 1.8,
  "1h": 1.5,
  "30m": 1.2,
  "15m": 1,
  "5m": 0.7,
  "3m": 0.5,
  "1m": 0.4,
};

function dirToBias(d: FlowDirection): MtfBiasDirection {
  if (d === "bullish") return "bullish";
  if (d === "bearish") return "bearish";
  return "neutral";
}

function scoreFromAnalysis(a: MoneyFlowAnalysis): number {
  let s = a.score * 0.55;
  if (a.structure.mss === "bullish") s += 12;
  if (a.structure.mss === "bearish") s -= 12;
  if (a.structure.bos === "bullish") s += 8;
  if (a.structure.bos === "bearish") s -= 8;
  if (a.ict.premiumDiscount === "DISCOUNT") s += 4;
  if (a.ict.premiumDiscount === "PREMIUM") s -= 4;
  const ict = a.ict as { inOte?: boolean };
  if (ict.inOte && a.structure.trend === "bullish") s += 5;
  if (ict.inOte && a.structure.trend === "bearish") s -= 5;
  return Math.max(-100, Math.min(100, s));
}

export function analyzeMtfBias(
  seriesByTf: Record<string, OhlcvBar[]>,
  weights: Record<string, number> = DEFAULT_MTF_WEIGHTS,
): MtfBiasResult {
  const reads: MtfTimeframeRead[] = [];

  for (const [tf, bars] of Object.entries(seriesByTf)) {
    if (!bars?.length) continue;
    const analysis = analyzeMoneyFlow(bars);
    const weight = weights[tf] ?? 1;
    if (!analysis) {
      reads.push({
        timeframe: tf,
        weight,
        bias: "neutral",
        confidence: 0,
        trend: "neutral",
        bos: null,
        choch: null,
        mss: null,
        premiumDiscount: "UNKNOWN",
        state: "UNCERTAIN",
        score: 0,
        analysis: null,
      });
      continue;
    }
    const score = scoreFromAnalysis(analysis);
    const bias: MtfBiasDirection =
      score >= 18 ? "bullish" : score <= -18 ? "bearish" : dirToBias(analysis.structure.trend);
    reads.push({
      timeframe: tf,
      weight,
      bias,
      confidence: analysis.confidence,
      trend: analysis.structure.trend,
      bos: analysis.structure.bos,
      choch: analysis.structure.choch,
      mss: analysis.structure.mss,
      premiumDiscount: analysis.ict.premiumDiscount,
      state: analysis.state,
      score,
      analysis,
    });
  }

  reads.sort((a, b) => b.weight - a.weight || a.timeframe.localeCompare(b.timeframe));

  if (!reads.length) {
    return {
      bias: "neutral",
      confidence: 0,
      score: 0,
      alignment: "insufficient",
      summary: "Chưa đủ dữ liệu đa khung thời gian.",
      timeframes: [],
      htfBias: "neutral",
      htfTimeframe: null,
    };
  }

  let wSum = 0;
  let weighted = 0;
  let confAcc = 0;
  for (const r of reads) {
    wSum += r.weight;
    weighted += r.score * r.weight;
    confAcc += r.confidence * r.weight;
  }
  const score = wSum > 0 ? weighted / wSum : 0;
  const confidence = Math.round(Math.max(15, Math.min(95, wSum > 0 ? confAcc / wSum : 0)));
  const bias: MtfBiasDirection = score >= 12 ? "bullish" : score <= -12 ? "bearish" : "neutral";

  const directional = reads.filter((r) => r.bias !== "neutral");
  const bulls = directional.filter((r) => r.bias === "bullish").length;
  const bears = directional.filter((r) => r.bias === "bearish").length;
  let alignment: MtfBiasResult["alignment"] = "mixed";
  if (directional.length < 2) alignment = "insufficient";
  else if (bulls === directional.length) alignment = "aligned_bull";
  else if (bears === directional.length) alignment = "aligned_bear";

  const htf = reads[0]!;
  const htfBias = htf.bias;

  const parts: string[] = [];
  parts.push(
    bias === "bullish"
      ? "Thiên tăng đa khung"
      : bias === "bearish"
        ? "Thiên giảm đa khung"
        : "Đa khung trung tính / lệch pha",
  );
  parts.push(
    `HTF ${htf.timeframe}: ${htfBias === "bullish" ? "tăng" : htfBias === "bearish" ? "giảm" : "trung tính"}`,
  );
  if (alignment === "aligned_bull") parts.push("các khung đồng thuận tăng");
  else if (alignment === "aligned_bear") parts.push("các khung đồng thuận giảm");
  else if (alignment === "mixed") parts.push("các khung chưa đồng thuận");

  return {
    bias,
    confidence,
    score: Math.round(score * 10) / 10,
    alignment,
    summary: parts.join(" · "),
    timeframes: reads,
    htfBias,
    htfTimeframe: htf.timeframe,
  };
}

/**
 * Suggested companion TFs for a chart timeframe (HTF → LTF cascade).
 * Returns up to 2 HTF + current + 1 LTF that exist in assetTfs.
 */
export function companionTimeframes(chartTf: string, assetTfs: readonly string[]): string[] {
  const order = [
    "12M",
    "1M",
    "1w",
    "1d",
    "12h",
    "6h",
    "4h",
    "2h",
    "1h",
    "30m",
    "15m",
    "5m",
    "3m",
    "1m",
  ];
  const available = order.filter((t) => assetTfs.includes(t));
  const idx = available.indexOf(chartTf);
  if (idx < 0) return available.slice(0, 4);
  const htfs = available.slice(0, idx).slice(-2);
  const ltfs = available.slice(idx + 1, idx + 2);
  return [...new Set([...htfs, chartTf, ...ltfs])];
}
