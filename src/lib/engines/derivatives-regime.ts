/**
 * P4 — Vietnam Derivatives Regime
 * Combines flow + curve shape + basis. No invented numbers.
 */

import type { DerivFlowKind } from "./derivatives-flow";
import type { CurveShape } from "./derivatives-curve";

export type DerivRegimeKind =
  | "risk_on_long"
  | "risk_off_short"
  | "squeeze_cover"
  | "liquidation"
  | "neutral_range"
  | "curve_stress"
  | "insufficient";

export interface DerivRegimeInput {
  flowKind: DerivFlowKind | null;
  flowConfidence?: number | null;
  curveShape: CurveShape | null;
  frontBasis: number | null;
  basisStressAbs?: number;
}

export interface DerivRegime {
  kind: DerivRegimeKind;
  title: string;
  titleVi: string;
  description: string;
  tone: "positive" | "negative" | "warning" | "muted";
  confidence: number;
  drivers: string[];
}

export function classifyDerivRegime(input: DerivRegimeInput): DerivRegime {
  const {
    flowKind,
    flowConfidence = 0.5,
    curveShape,
    frontBasis,
    basisStressAbs = 15,
  } = input;

  const drivers: string[] = [];
  if (flowKind && flowKind !== "insufficient" && flowKind !== "neutral") {
    drivers.push(`flow:${flowKind}`);
  }
  if (curveShape && curveShape !== "insufficient") {
    drivers.push(`curve:${curveShape}`);
  }
  if (frontBasis != null && Number.isFinite(frontBasis)) {
    drivers.push(`basis:${frontBasis.toFixed(1)}`);
  }

  if (
    (!flowKind || flowKind === "insufficient") &&
    (!curveShape || curveShape === "insufficient") &&
    frontBasis == null
  ) {
    return {
      kind: "insufficient",
      title: "Insufficient",
      titleVi: "Thiếu dữ liệu",
      description: "Cần quote/OI/curve đo được — không suy diễn regime",
      tone: "muted",
      confidence: 0,
      drivers,
    };
  }

  if (frontBasis != null && frontBasis < -basisStressAbs) {
    return {
      kind: "curve_stress",
      title: "Basis stress",
      titleVi: "Basis căng (âm sâu)",
      description: `Front basis ${frontBasis.toFixed(1)} pts — theo dõi roll / định giá`,
      tone: "warning",
      confidence: Math.min(0.9, 0.55 + Math.min(0.35, Math.abs(frontBasis) / 40)),
      drivers,
    };
  }

  if (flowKind === "long_build_up") {
    return {
      kind: "risk_on_long",
      title: "Risk-on / long build-up",
      titleVi: "Thiên long (build-up)",
      description: "Giá ↑ · OI ↑ — dòng tiền mở long",
      tone: "positive",
      confidence: flowConfidence ?? 0.6,
      drivers,
    };
  }
  if (flowKind === "short_build_up") {
    return {
      kind: "risk_off_short",
      title: "Risk-off / short build-up",
      titleVi: "Thiên short (build-up)",
      description: "Giá ↓ · OI ↑ — dòng tiền mở short",
      tone: "negative",
      confidence: flowConfidence ?? 0.6,
      drivers,
    };
  }
  if (flowKind === "short_covering") {
    return {
      kind: "squeeze_cover",
      title: "Short covering",
      titleVi: "Short covering",
      description: "Giá ↑ · OI ↓ — đóng short",
      tone: "positive",
      confidence: flowConfidence ?? 0.55,
      drivers,
    };
  }
  if (flowKind === "long_liquidation") {
    return {
      kind: "liquidation",
      title: "Long liquidation",
      titleVi: "Long liquidation",
      description: "Giá ↓ · OI ↓ — đóng long",
      tone: "negative",
      confidence: flowConfidence ?? 0.55,
      drivers,
    };
  }

  if (curveShape === "backwardation") {
    return {
      kind: "curve_stress",
      title: "Backwardation",
      titleVi: "Curve backwardation",
      description: "Near > far — cầu kỳ hạn gần / định giá căng",
      tone: "warning",
      confidence: 0.5,
      drivers,
    };
  }
  if (curveShape === "contango") {
    return {
      kind: "neutral_range",
      title: "Contango neutral",
      titleVi: "Contango (trung tính)",
      description: "Far > near — cấu trúc kỳ hạn bình thường nếu basis ôn hòa",
      tone: "muted",
      confidence: 0.45,
      drivers,
    };
  }

  return {
    kind: "neutral_range",
    title: "Neutral",
    titleVi: "Trung lập",
    description: "Chưa có tín hiệu flow/curve rõ",
    tone: "muted",
    confidence: 0.35,
    drivers,
  };
}
