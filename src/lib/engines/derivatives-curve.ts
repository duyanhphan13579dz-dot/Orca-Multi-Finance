/**
 * Vietnam Derivatives Term Structure & Spreads (P2)
 *
 * Pure functions — no fabricated prices. Callers pass measured lasts.
 *
 * Curve points ordered by days-to-expiry when known, else by continuous alias priority.
 * Calendar spread = near − far (points). Contango when far > near; backwardation when near > far.
 */

export type CurveShape = "contango" | "backwardation" | "flat" | "mixed" | "insufficient";

export interface CurvePointInput {
  symbol: string;
  last: number | null;
  daysToExpiry?: number | null;
  priority?: number | null;
  openInterest?: number | null;
  volume?: number | null;
  basis?: number | null;
}

export interface CurvePoint {
  symbol: string;
  last: number | null;
  daysToExpiry: number | null;
  openInterest: number | null;
  volume: number | null;
  basis: number | null;
  /** Rank on curve (0 = front) */
  rank: number;
}

export interface CalendarSpread {
  near: string;
  far: string;
  nearLast: number;
  farLast: number;
  spread: number; // near − far
  spreadPct: number; // (near − far) / far * 100
  shape: "contango" | "backwardation" | "flat";
}

export interface TermStructureResult {
  underlying: string;
  points: CurvePoint[];
  spreads: CalendarSpread[];
  shape: CurveShape;
  front: CurvePoint | null;
  /** Front − spot when both available */
  frontBasis: number | null;
  spot: number | null;
  note: string;
  rollYieldAnnualizedPct?: number | null;
}

const EPS = 1e-6;

function sortPoints(inputs: CurvePointInput[]): CurvePointInput[] {
  return [...inputs].sort((a, b) => {
    const da = a.daysToExpiry;
    const db = b.daysToExpiry;
    if (da != null && db != null && Number.isFinite(da) && Number.isFinite(db)) {
      return da - db;
    }
    const pa = a.priority ?? 99;
    const pb = b.priority ?? 99;
    return pa - pb;
  });
}

export function buildTermStructure(
  underlying: string,
  inputs: CurvePointInput[],
  spot: number | null = null,
): TermStructureResult {
  const sorted = sortPoints(inputs);
  const points: CurvePoint[] = sorted.map((p, i) => ({
    symbol: p.symbol,
    last: p.last != null && Number.isFinite(p.last) && p.last > 0 ? p.last : null,
    daysToExpiry: p.daysToExpiry ?? null,
    openInterest: p.openInterest ?? null,
    volume: p.volume ?? null,
    basis: p.basis ?? null,
    rank: i,
  }));

  const withPrice = points.filter((p) => p.last != null) as Array<CurvePoint & { last: number }>;
  const spreads: CalendarSpread[] = [];

  for (let i = 0; i < withPrice.length - 1; i++) {
    const near = withPrice[i];
    const far = withPrice[i + 1];
    const spread = near.last - far.last;
    const spreadPct = far.last !== 0 ? (spread / far.last) * 100 : 0;
    let shape: CalendarSpread["shape"] = "flat";
    if (spread > EPS) shape = "backwardation";
    else if (spread < -EPS) shape = "contango";
    spreads.push({
      near: near.symbol,
      far: far.symbol,
      nearLast: near.last,
      farLast: far.last,
      spread: Math.round(spread * 1000) / 1000,
      spreadPct: Math.round(spreadPct * 1000) / 1000,
      shape,
    });
  }

  let shape: CurveShape = "insufficient";
  if (withPrice.length < 2) {
    shape = withPrice.length === 1 ? "flat" : "insufficient";
  } else {
    const signs = spreads.map((s) => s.shape);
    const allContango = signs.every((s) => s === "contango" || s === "flat");
    const allBack = signs.every((s) => s === "backwardation" || s === "flat");
    const anyC = signs.some((s) => s === "contango");
    const anyB = signs.some((s) => s === "backwardation");
    if (anyC && anyB) shape = "mixed";
    else if (allContango && anyC) shape = "contango";
    else if (allBack && anyB) shape = "backwardation";
    else shape = "flat";
  }

  const front = points[0] ?? null;
  const frontBasis =
    front?.last != null && spot != null && Number.isFinite(spot) && spot > 0
      ? front.last - spot
      : null;

  const priced = withPrice.length;
  const note =
    priced === 0
      ? "Chưa có giá futures — curve UNAVAILABLE"
      : priced < 2
        ? "Chỉ 1 leg có giá — chưa đủ calendar spread"
        : `Curve ${shape} · ${spreads.length} spread(s)`;

  return {
    underlying,
    points,
    spreads,
    shape,
    front,
    frontBasis,
    spot,
    note,
  };
}

/** Roll yield heuristic: annualized from front→next spread and days between expiries. */
export function estimateRollYieldAnnualized(
  nearLast: number,
  farLast: number,
  daysNear: number | null,
  daysFar: number | null,
): number | null {
  if (!Number.isFinite(nearLast) || !Number.isFinite(farLast) || farLast <= 0) return null;
  if (daysNear == null || daysFar == null) return null;
  const dt = daysFar - daysNear;
  if (dt <= 0) return null;
  return ((farLast / nearLast - 1) * (365 / dt)) * 100;
}
