/**
 * Hiệu suất đầu tư — Beta / Sharpe / Jensen Alpha / TSR.
 * Alpha: hồi quy CAPM trên excess return (R − rf), OLS intercept annualized ×252.
 */

export type PerformanceMetrics = {
  tsr: number | null;
  tsr1y: number | null;
  beta: number | null;
  sharpe: number | null;
  /** Jensen alpha annualized (excess-return CAPM) */
  alpha: number | null;
  /** R² của hồi quy CAPM (0–1) */
  alphaR2: number | null;
  /** Tracking error annualized */
  trackingError: number | null;
  /** Information ratio = alpha / TE */
  informationRatio: number | null;
  dividendYield: number | null;
  payoutRatio: number | null;
  sampleDays: number;
  indexSampleDays?: number;
  note?: string;
};

function dailyReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1]!;
    const b = closes[i]!;
    if (a > 0 && Number.isFinite(a) && Number.isFinite(b)) out.push((b - a) / a);
  }
  return out;
}

function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function variance(xs: number[], mu?: number): number | null {
  if (xs.length < 2) return null;
  const m = mu ?? mean(xs);
  if (m == null) return null;
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return s / (xs.length - 1);
}

function stdev(xs: number[]): number | null {
  const v = variance(xs);
  return v != null && v >= 0 ? Math.sqrt(v) : null;
}

function covariance(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const a = xs.slice(0, n);
  const b = ys.slice(0, n);
  const mx = mean(a);
  const my = mean(b);
  if (mx == null || my == null) return null;
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i]! - mx) * (b[i]! - my);
  return s / (n - 1);
}

function alignTail(a: number[], b: number[]): [number[], number[]] {
  const n = Math.min(a.length, b.length);
  if (n < 3) return [[], []];
  return [a.slice(a.length - n), b.slice(b.length - n)];
}

/** Winsorize tại p1/p99 để giảm nhiễu phiên bất thường */
function winsorize(xs: number[], pLo = 0.01, pHi = 0.99): number[] {
  if (xs.length < 10) return xs.slice();
  const sorted = [...xs].sort((a, b) => a - b);
  const lo = sorted[Math.floor((sorted.length - 1) * pLo)]!;
  const hi = sorted[Math.floor((sorted.length - 1) * pHi)]!;
  return xs.map((x) => Math.min(hi, Math.max(lo, x)));
}

/**
 * OLS: y = alpha + beta * x + e
 * Trả intercept (alpha daily), slope (beta), R², residual stdev.
 */
function ols(y: number[], x: number[]): {
  alpha: number;
  beta: number;
  r2: number;
  residStd: number;
} | null {
  const n = Math.min(y.length, x.length);
  if (n < 5) return null;
  const yy = y.slice(0, n);
  const xx = x.slice(0, n);
  const my = mean(yy);
  const mx = mean(xx);
  if (my == null || mx == null) return null;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xx[i]! - mx;
    const dy = yy[i]! - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx < 1e-18) return null;
  const beta = sxy / sxx;
  const alpha = my - beta * mx;
  const ssTot = syy;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const e = yy[i]! - (alpha + beta * xx[i]!);
    ssRes += e * e;
  }
  const r2 = ssTot > 1e-18 ? Math.max(0, Math.min(1, 1 - ssRes / ssTot)) : 0;
  const residStd = n > 2 ? Math.sqrt(ssRes / (n - 2)) : Math.sqrt(ssRes / Math.max(1, n));
  return { alpha, beta, r2, residStd };
}

/** rf năm mặc định; có thể override khi có lãi suất VN */
const RF_ANNUAL_DEFAULT = 0.05;
const TRADING_DAYS = 252;

export function computeInvestmentPerformance(opts: {
  closes: number[];
  indexCloses?: number[] | null;
  dividendYield?: number | null;
  netIncome?: number | null;
  annualDividendCash?: number | null;
  /** Lãi phi rủi ro năm (vd 0.045 từ bảng lãi suất) */
  riskFreeAnnual?: number | null;
}): PerformanceMetrics {
  const closes = opts.closes.filter((c) => Number.isFinite(c) && c > 0);
  const idxRaw = (opts.indexCloses ?? []).filter((c) => Number.isFinite(c) && c > 0);
  const rfAnn =
    opts.riskFreeAnnual != null && opts.riskFreeAnnual >= 0 && opts.riskFreeAnnual < 0.25
      ? opts.riskFreeAnnual
      : RF_ANNUAL_DEFAULT;
  const rfDaily = rfAnn / TRADING_DAYS;

  const empty: PerformanceMetrics = {
    tsr: null,
    tsr1y: null,
    beta: null,
    sharpe: null,
    alpha: null,
    alphaR2: null,
    trackingError: null,
    informationRatio: null,
    dividendYield: opts.dividendYield ?? null,
    payoutRatio: null,
    sampleDays: closes.length,
    indexSampleDays: idxRaw.length,
  };

  if (closes.length < 5) {
    return {
      ...empty,
      note: `Chưa đủ chuỗi giá (có ${closes.length} phiên, cần ≥5)`,
    };
  }

  const tsr =
    closes[0]! > 0 ? (closes[closes.length - 1]! - closes[0]!) / closes[0]! : null;

  let tsr1y: number | null = null;
  if (closes.length >= 40) {
    const look = Math.min(TRADING_DAYS, closes.length - 1);
    const a = closes[closes.length - 1 - look]!;
    const z = closes[closes.length - 1]!;
    if (a > 0) tsr1y = (z - a) / a;
  }

  const retsRaw = dailyReturns(closes);
  const rets = winsorize(retsRaw);
  const mu = mean(rets);
  const sd = stdev(rets);
  let sharpe: number | null = null;
  if (mu != null && sd != null && sd > 1e-12 && rets.length >= 20) {
    sharpe = (mu * TRADING_DAYS - rfAnn) / (sd * Math.sqrt(TRADING_DAYS));
  }

  let beta: number | null = null;
  let alpha: number | null = null;
  let alphaR2: number | null = null;
  let trackingError: number | null = null;
  let informationRatio: number | null = null;

  const minPairs = 20;
  if (idxRaw.length >= minPairs + 1 && closes.length >= minPairs + 1) {
    const [sc, ic] = alignTail(closes, idxRaw);
    let rs = winsorize(dailyReturns(sc));
    let rm = winsorize(dailyReturns(ic));
    const n = Math.min(rs.length, rm.length);
    if (n >= minPairs) {
      rs = rs.slice(rs.length - n);
      rm = rm.slice(rm.length - n);

      // Excess returns (CAPM)
      const ys = rs.map((r) => r - rfDaily);
      const xs = rm.map((r) => r - rfDaily);

      const fit = ols(ys, xs);
      if (fit) {
        beta = fit.beta;
        // Jensen alpha daily → annual
        alpha = fit.alpha * TRADING_DAYS;
        alphaR2 = fit.r2;
        // Tracking error ≈ residual vol annualized
        trackingError = fit.residStd * Math.sqrt(TRADING_DAYS);
        if (trackingError > 1e-8) {
          informationRatio = alpha / trackingError;
        }
      } else {
        // Fallback cov/var trên excess
        const cov = covariance(ys, xs);
        const varM = variance(xs);
        if (cov != null && varM != null && varM > 1e-14) {
          beta = cov / varM;
          const ms = mean(ys);
          const mm = mean(xs);
          if (ms != null && mm != null) {
            alpha = (ms - beta * mm) * TRADING_DAYS;
          }
        }
      }
    }
  }

  let payoutRatio: number | null = null;
  const dy = opts.dividendYield;
  const ni = opts.netIncome;
  const divCash = opts.annualDividendCash;
  if (divCash != null && ni != null && ni > 0) {
    payoutRatio = divCash / ni;
  }

  const clamp = (v: number | null, lo: number, hi: number) =>
    v == null || !Number.isFinite(v) ? null : Math.min(hi, Math.max(lo, v));

  const notes: string[] = [];
  notes.push(`${closes.length} phiên mã`);
  if (idxRaw.length) notes.push(`${idxRaw.length} phiên VNINDEX`);
  if (beta == null) notes.push("Beta/Alpha cần ≥20 phiên đồng thời với VNINDEX");
  else {
    notes.push(`CAPM excess · rf≈${(rfAnn * 100).toFixed(1)}%`);
    if (alphaR2 != null) notes.push(`R²=${(alphaR2 * 100).toFixed(0)}%`);
  }
  if (dy == null) notes.push("Chưa có DIVIDEND_YIELD từ ratios");

  return {
    tsr: clamp(tsr, -0.99, 20),
    tsr1y: clamp(tsr1y, -0.99, 20),
    beta: clamp(beta, -3, 5),
    sharpe: clamp(sharpe, -5, 8),
    alpha: clamp(alpha, -2, 5),
    alphaR2: alphaR2 != null ? Math.min(1, Math.max(0, alphaR2)) : null,
    trackingError: clamp(trackingError, 0, 5),
    informationRatio: clamp(informationRatio, -5, 5),
    dividendYield: dy != null && dy >= 0 && dy < 0.5 ? dy : null,
    payoutRatio: clamp(payoutRatio, 0, 2),
    sampleDays: closes.length,
    indexSampleDays: idxRaw.length,
    note: notes.join(" · "),
  };
}
