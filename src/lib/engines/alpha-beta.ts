/**
 * Alpha / Beta engine (CAPM single-index)
 * Weekly log-returns, OLS: R_i - Rf = α + β (R_m - Rf) + ε
 * Ref: research report — Alpha, Beta và lọc cổ phiếu alpha tốt – định giá thấp.
 */

import type { OhlcvBar } from "../types";

export type AlphaBetaProfile =
  | "alpha_high_beta_low"
  | "alpha_high_beta_high"
  | "alpha_flat_beta_high"
  | "alpha_neg_beta_low"
  | "alpha_neg_beta_high"
  | "insufficient";

export interface AlphaBetaSnapshot {
  /** Raw OLS beta */
  beta: number | null;
  /** Blume adjusted: 0.67*raw + 0.33 */
  betaAdj: number | null;
  /** Dimson beta (sum of contemporaneous + lag-1 market coeffs) */
  betaDimson: number | null;
  betaUp: number | null;
  betaDown: number | null;
  /** Annualized Jensen alpha (weekly α × 52) */
  alphaAnnual: number | null;
  /** t-stat of intercept */
  alphaT: number | null;
  r2: number | null;
  seBeta: number | null;
  n: number;
  /** Half-sample alpha signs for stability */
  alphaH1: number | null;
  alphaH2: number | null;
  profile: AlphaBetaProfile;
  profileVi: string;
  quality: {
    reliable: boolean;
    lowR2: boolean;
    wideSe: boolean;
    flags: string[];
  };
  benchmark: string;
  window: string;
  summary: string;
}

const MIN_OBS = 40;
const PERIODS_PER_YEAR = 52;

function weekKey(ts: number): string {
  const d = new Date(ts);
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((day.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/** Last close per calendar week (sorted ascending). */
function weeklyCloses(bars: OhlcvBar[]): { t: number; close: number }[] {
  const map = new Map<string, { t: number; close: number }>();
  const sorted = [...bars]
    .filter((b) => b && Number.isFinite(b.time) && Number.isFinite(b.close) && b.close > 0)
    .sort((a, b) => a.time - b.time);
  for (const b of sorted) {
    map.set(weekKey(b.time), { t: b.time, close: b.close });
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

function logReturns(closes: { t: number; close: number }[]): { t: number; r: number }[] {
  const out: { t: number; r: number }[] = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1]!.close;
    const b = closes[i]!.close;
    if (a > 0 && b > 0) {
      const r = Math.log(b / a);
      if (Number.isFinite(r)) out.push({ t: closes[i]!.t, r });
    }
  }
  return out;
}

function align(
  stock: { t: number; r: number }[],
  mkt: { t: number; r: number }[],
): { y: number[]; x: number[] } {
  const m = new Map(mkt.map((p) => [weekKey(p.t), p.r]));
  const y: number[] = [];
  const x: number[] = [];
  for (const s of stock) {
    const mr = m.get(weekKey(s.t));
    if (mr == null || !Number.isFinite(mr)) continue;
    y.push(s.r);
    x.push(mr);
  }
  return { y, x };
}

/** Simple OLS y = a + b x */
function ols(y: number[], x: number[]): {
  a: number;
  b: number;
  r2: number;
  seA: number;
  seB: number;
  tA: number;
  n: number;
} | null {
  const n = y.length;
  if (n < MIN_OBS) return null;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[i]!;
    const yi = y[i]!;
    sx += xi;
    sy += yi;
    sxx += xi * xi;
    syy += yi * yi;
    sxy += xi * yi;
  }
  const mx = sx / n;
  const my = sy / n;
  const cov = sxy - n * mx * my;
  const varX = sxx - n * mx * mx;
  const varY = syy - n * my * my;
  if (varX <= 1e-18) return null;
  const b = cov / varX;
  const a = my - b * mx;
  const ssTot = varY;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const e = y[i]! - (a + b * x[i]!);
    ssRes += e * e;
  }
  const r2 = ssTot > 1e-18 ? 1 - ssRes / ssTot : 0;
  const df = n - 2;
  if (df < 1) return null;
  const mse = ssRes / df;
  const seB = Math.sqrt(mse / varX);
  const seA = Math.sqrt(mse * (1 / n + (mx * mx) / varX));
  const tA = seA > 1e-12 ? a / seA : 0;
  return { a, b, r2: Math.max(0, Math.min(1, r2)), seA, seB, tA, n };
}

function dimsonBeta(y: number[], x: number[]): number | null {
  if (y.length < MIN_OBS + 1) return null;
  const y2: number[] = [];
  const x0: number[] = [];
  const x1: number[] = [];
  for (let i = 1; i < y.length; i++) {
    y2.push(y[i]!);
    x0.push(x[i]!);
    x1.push(x[i - 1]!);
  }
  const n = y2.length;
  let S00 = n, S01 = 0, S02 = 0, S11 = 0, S12 = 0, S22 = 0;
  let T0 = 0, T1 = 0, T2 = 0;
  for (let i = 0; i < n; i++) {
    const z1 = x0[i]!;
    const z2 = x1[i]!;
    const yi = y2[i]!;
    S01 += z1;
    S02 += z2;
    S11 += z1 * z1;
    S12 += z1 * z2;
    S22 += z2 * z2;
    T0 += yi;
    T1 += z1 * yi;
    T2 += z2 * yi;
  }
  const A = [
    [S00, S01, S02],
    [S01, S11, S12],
    [S02, S12, S22],
  ];
  const T = [T0, T1, T2];
  const M = A.map((row, i) => [...row, T[i]!]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    if (Math.abs(M[piv]![col]!) < 1e-14) return null;
    if (piv !== col) {
      const tmp = M[col]!;
      M[col] = M[piv]!;
      M[piv] = tmp;
    }
    const div = M[col]![col]!;
    for (let c = col; c < 4; c++) M[col]![c]! /= div;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = M[r]![col]!;
      for (let c = col; c < 4; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  const b0 = M[1]![3]!;
  const b1 = M[2]![3]!;
  return b0 + b1;
}

function conditionalBeta(y: number[], x: number[], up: boolean): number | null {
  const yy: number[] = [];
  const xx: number[] = [];
  for (let i = 0; i < y.length; i++) {
    if (up ? x[i]! > 0 : x[i]! < 0) {
      yy.push(y[i]!);
      xx.push(x[i]!);
    }
  }
  if (yy.length < 20) return null;
  const m = ols(yy, xx);
  return m?.b ?? null;
}

function classify(alphaAnn: number | null, alphaT: number | null, beta: number | null): {
  profile: AlphaBetaProfile;
  profileVi: string;
} {
  if (alphaAnn == null || beta == null || alphaT == null) {
    return { profile: "insufficient", profileVi: "Chưa đủ dữ liệu" };
  }
  const sig = Math.abs(alphaT) >= 2;
  const aPos = alphaAnn > 0 && sig;
  const aNeg = alphaAnn < 0 && sig;
  const aFlat = !sig || Math.abs(alphaAnn) < 0.02;
  const bHigh = beta >= 1.15;
  const bLow = beta <= 0.85;

  if (aPos && bLow) return { profile: "alpha_high_beta_low", profileVi: "Alpha cao · Beta thấp (lý tưởng)" };
  if (aPos && bHigh) return { profile: "alpha_high_beta_high", profileVi: "Alpha cao · Beta cao" };
  if (aPos) return { profile: "alpha_high_beta_low", profileVi: "Alpha dương · Beta trung bình" };
  if (aFlat && bHigh) return { profile: "alpha_flat_beta_high", profileVi: "Alpha ≈ 0 · Beta cao (đòn bẩy TT)" };
  if (aNeg && bLow) return { profile: "alpha_neg_beta_low", profileVi: "Alpha âm · Beta thấp" };
  if (aNeg && bHigh) return { profile: "alpha_neg_beta_high", profileVi: "Alpha âm · Beta cao (tránh)" };
  return { profile: "insufficient", profileVi: "Alpha chưa rõ · cần thêm xác nhận" };
}

function buildSummary(s: Omit<AlphaBetaSnapshot, "summary">): string {
  if (s.beta == null || s.n < MIN_OBS) {
    return "Chưa đủ quan sát tuần để ước lượng alpha/beta đáng tin.";
  }
  const parts: string[] = [];
  if (s.alphaAnnual != null && s.alphaT != null) {
    const pct = (s.alphaAnnual * 100).toFixed(1);
    parts.push(
      `Alpha ${s.alphaAnnual >= 0 ? "+" : ""}${pct}%/năm (t=${s.alphaT.toFixed(2)})`,
    );
  }
  parts.push(`β=${s.beta.toFixed(2)} (adj ${s.betaAdj?.toFixed(2) ?? "—"})`);
  if (s.r2 != null) parts.push(`R²=${(s.r2 * 100).toFixed(0)}%`);
  parts.push(s.profileVi);
  if (s.quality.flags.length) parts.push(`⚠ ${s.quality.flags.join(", ")}`);
  return parts.join(" · ");
}

/**
 * Compute CAPM alpha/beta from daily OHLCV of stock and market (e.g. VNINDEX).
 * Uses weekly log-returns, ~2y window preferred.
 */
export function computeAlphaBeta(
  stockBars: OhlcvBar[],
  marketBars: OhlcvBar[],
  opts?: { rfWeekly?: number; benchmark?: string },
): AlphaBetaSnapshot {
  const empty: AlphaBetaSnapshot = {
    beta: null,
    betaAdj: null,
    betaDimson: null,
    betaUp: null,
    betaDown: null,
    alphaAnnual: null,
    alphaT: null,
    r2: null,
    seBeta: null,
    n: 0,
    alphaH1: null,
    alphaH2: null,
    profile: "insufficient",
    profileVi: "Chưa đủ dữ liệu",
    quality: { reliable: false, lowR2: true, wideSe: true, flags: ["thiếu dữ liệu"] },
    benchmark: opts?.benchmark ?? "VNINDEX",
    window: "weekly~2y",
    summary: "Chưa đủ quan sát tuần để ước lượng alpha/beta đáng tin.",
  };

  if (!stockBars?.length || !marketBars?.length) return empty;

  const sRet = logReturns(weeklyCloses(stockBars));
  const mRet = logReturns(weeklyCloses(marketBars));
  const { y: y0, x: x0 } = align(sRet, mRet);
  const rf = opts?.rfWeekly ?? 0;
  const y = y0.map((v) => v - rf);
  const x = x0.map((v) => v - rf);

  const fit = ols(y, x);
  if (!fit) return empty;

  const alphaAnnual = fit.a * PERIODS_PER_YEAR;
  const betaAdj = 0.67 * fit.b + 0.33;
  const betaDimson = dimsonBeta(y, x);
  const betaUp = conditionalBeta(y, x, true);
  const betaDown = conditionalBeta(y, x, false);

  const mid = Math.floor(y.length / 2);
  const h1 = ols(y.slice(0, mid), x.slice(0, mid));
  const h2 = ols(y.slice(mid), x.slice(mid));
  const alphaH1 = h1 ? h1.a * PERIODS_PER_YEAR : null;
  const alphaH2 = h2 ? h2.a * PERIODS_PER_YEAR : null;

  const flags: string[] = [];
  const lowR2 = fit.r2 < 0.15;
  const wideSe = fit.seB > 0.35;
  if (lowR2) flags.push("R² thấp — beta kém tin cậy");
  if (wideSe) flags.push("SE(β) lớn");
  if (Math.abs(fit.tA) < 2) flags.push("alpha chưa có ý nghĩa thống kê (|t|<2)");
  if (fit.n < 60) flags.push("mẫu còn mỏng");

  const { profile, profileVi } = classify(alphaAnnual, fit.tA, fit.b);
  const reliable = !lowR2 && !wideSe && fit.n >= 60;

  const snap: AlphaBetaSnapshot = {
    beta: round4(fit.b),
    betaAdj: round4(betaAdj),
    betaDimson: betaDimson != null ? round4(betaDimson) : null,
    betaUp: betaUp != null ? round4(betaUp) : null,
    betaDown: betaDown != null ? round4(betaDown) : null,
    alphaAnnual: round4(alphaAnnual),
    alphaT: round4(fit.tA),
    r2: round4(fit.r2),
    seBeta: round4(fit.seB),
    n: fit.n,
    alphaH1: alphaH1 != null ? round4(alphaH1) : null,
    alphaH2: alphaH2 != null ? round4(alphaH2) : null,
    profile,
    profileVi,
    quality: { reliable, lowR2, wideSe, flags },
    benchmark: opts?.benchmark ?? "VNINDEX",
    window: `weekly · ${fit.n} obs`,
    summary: "",
  };
  snap.summary = buildSummary(snap);
  return snap;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
