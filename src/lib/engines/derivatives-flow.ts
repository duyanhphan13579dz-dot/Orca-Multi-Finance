/**
 * Vietnam Derivatives Flow Engine (P1.5)
 *
 * Pure classification from price change × open-interest change.
 * Does not invent numbers — callers pass measured deltas.
 *
 * | Price | OI  | Signal            |
 * |-------|-----|-------------------|
 * | ↑     | ↑   | Long Build-up     |
 * | ↓     | ↑   | Short Build-up    |
 * | ↑     | ↓   | Short Covering    |
 * | ↓     | ↓   | Long Liquidation  |
 */

export type DerivFlowKind =
  | "long_build_up"
  | "short_build_up"
  | "short_covering"
  | "long_liquidation"
  | "neutral"
  | "insufficient";

export interface DerivFlowInput {
  symbol: string;
  priceChange: number | null;
  /** Absolute or relative OI change; sign matters */
  oiChange: number | null;
  volume?: number | null;
  /** Optional prior session volume for effort context */
  priorVolume?: number | null;
  basis?: number | null;
  priorBasis?: number | null;
}

export interface DerivFlowSignal {
  symbol: string;
  kind: DerivFlowKind;
  title: string;
  titleVi: string;
  description: string;
  confidence: number; // 0–1
  priceChange: number | null;
  oiChange: number | null;
  volume: number | null;
  basisChange: number | null;
  tone: "positive" | "negative" | "warning" | "muted";
}

const TITLES: Record<
  Exclude<DerivFlowKind, "insufficient" | "neutral">,
  { en: string; vi: string; tone: DerivFlowSignal["tone"]; desc: string }
> = {
  long_build_up: {
    en: "Long build-up",
    vi: "Long build-up",
    tone: "positive",
    desc: "Giá ↑ · OI ↑ — dòng tiền mở long mới",
  },
  short_build_up: {
    en: "Short build-up",
    vi: "Short build-up",
    tone: "negative",
    desc: "Giá ↓ · OI ↑ — dòng tiền mở short mới",
  },
  short_covering: {
    en: "Short covering",
    vi: "Short covering",
    tone: "positive",
    desc: "Giá ↑ · OI ↓ — đóng short / cover",
  },
  long_liquidation: {
    en: "Long liquidation",
    vi: "Long liquidation",
    tone: "negative",
    desc: "Giá ↓ · OI ↓ — đóng long / cắt lỗ",
  },
};

/** Minimum |Δ| to treat as directional (avoid noise). */
const EPS_PRICE = 1e-9;
const EPS_OI = 1e-9;

export function classifyDerivFlow(input: DerivFlowInput): DerivFlowSignal {
  const { symbol, priceChange, oiChange, volume = null, basis = null, priorBasis = null } = input;
  const basisChange =
    basis != null && priorBasis != null && Number.isFinite(basis) && Number.isFinite(priorBasis)
      ? basis - priorBasis
      : null;

  if (priceChange == null || oiChange == null || !Number.isFinite(priceChange) || !Number.isFinite(oiChange)) {
    return {
      symbol,
      kind: "insufficient",
      title: "Insufficient data",
      titleVi: "Thiếu dữ liệu",
      description: "Cần Δ giá và Δ OI đo được — không suy diễn",
      confidence: 0,
      priceChange,
      oiChange,
      volume,
      basisChange,
      tone: "muted",
    };
  }

  if (Math.abs(priceChange) < EPS_PRICE && Math.abs(oiChange) < EPS_OI) {
    return {
      symbol,
      kind: "neutral",
      title: "Neutral",
      titleVi: "Trung lập",
      description: "Giá và OI gần như không đổi",
      confidence: 0.3,
      priceChange,
      oiChange,
      volume,
      basisChange,
      tone: "muted",
    };
  }

  // One leg flat → lower confidence neutral/partial
  if (Math.abs(priceChange) < EPS_PRICE || Math.abs(oiChange) < EPS_OI) {
    return {
      symbol,
      kind: "neutral",
      title: "Mixed / flat leg",
      titleVi: "Tín hiệu lẫn",
      description: "Chỉ một trong Δ giá hoặc Δ OI có hướng rõ",
      confidence: 0.35,
      priceChange,
      oiChange,
      volume,
      basisChange,
      tone: "warning",
    };
  }

  const pxUp = priceChange > 0;
  const oiUp = oiChange > 0;
  let kind: DerivFlowKind;
  if (pxUp && oiUp) kind = "long_build_up";
  else if (!pxUp && oiUp) kind = "short_build_up";
  else if (pxUp && !oiUp) kind = "short_covering";
  else kind = "long_liquidation";

  const meta = TITLES[kind as Exclude<DerivFlowKind, "insufficient" | "neutral">];

  // Confidence from magnitude consistency (heuristic, capped)
  const mag = Math.min(1, Math.abs(priceChange) / 10 + Math.abs(oiChange) / (Math.abs(oiChange) + 500));
  let confidence = 0.55 + 0.35 * mag;
  if (volume != null && volume > 0 && input.priorVolume != null && input.priorVolume > 0) {
    if (volume > input.priorVolume * 1.1) confidence = Math.min(0.95, confidence + 0.08);
  }
  if (basisChange != null) {
    if (kind === "long_build_up" && basisChange > 0) confidence = Math.min(0.95, confidence + 0.05);
    if (kind === "short_build_up" && basisChange < 0) confidence = Math.min(0.95, confidence + 0.05);
  }

  return {
    symbol,
    kind,
    title: meta.en,
    titleVi: meta.vi,
    description: meta.desc,
    confidence: Math.round(confidence * 100) / 100,
    priceChange,
    oiChange,
    volume,
    basisChange,
    tone: meta.tone,
  };
}

/**
 * Build flow signal from two quote snapshots (current vs prior).
 */
export function flowFromQuotes(
  symbol: string,
  current: { last: number | null; openInterest?: number | null; volume?: number | null; change?: number | null },
  prior: { last: number | null; openInterest?: number | null; volume?: number | null } | null,
  basis?: number | null,
  priorBasis?: number | null,
): DerivFlowSignal {
  const priceChange =
    current.change != null && Number.isFinite(current.change)
      ? current.change
      : current.last != null && prior?.last != null
        ? current.last - prior.last
        : null;
  const oiChange =
    current.openInterest != null && prior?.openInterest != null
      ? current.openInterest - prior.openInterest
      : null;

  return classifyDerivFlow({
    symbol,
    priceChange,
    oiChange,
    volume: current.volume ?? null,
    priorVolume: prior?.volume ?? null,
    basis: basis ?? null,
    priorBasis: priorBasis ?? null,
  });
}

/**
 * From daily OHLCV: use last two closes as price change; OI must be supplied separately.
 */
export function flowFromBarsAndOi(
  symbol: string,
  bars: { close: number; volume: number }[],
  oiNow: number | null,
  oiPrior: number | null,
  basis?: number | null,
): DerivFlowSignal {
  if (bars.length < 2) {
    return classifyDerivFlow({
      symbol,
      priceChange: null,
      oiChange: oiNow != null && oiPrior != null ? oiNow - oiPrior : null,
      volume: bars[0]?.volume ?? null,
      basis: basis ?? null,
    });
  }
  const a = bars[bars.length - 2];
  const b = bars[bars.length - 1];
  return classifyDerivFlow({
    symbol,
    priceChange: b.close - a.close,
    oiChange: oiNow != null && oiPrior != null ? oiNow - oiPrior : null,
    volume: b.volume,
    priorVolume: a.volume,
    basis: basis ?? null,
  });
}
