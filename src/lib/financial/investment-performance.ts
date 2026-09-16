/**
 * Hiệu suất đầu tư — Beta / Sharpe / Alpha / TSR từ chuỗi giá đóng cửa.
 * Chỉ tính khi đủ mẫu; không bịa số.
 */

export type PerformanceMetrics = {
  tsr: number | null;
  /** ~1 năm lịch nếu đủ bar */
  tsr1y: number | null;
  beta: number | null;
  sharpe: number | null;
  /** Alpha hàng năm (Jensen, rf ≈ 5%) */
  alpha: number | null;
  /** Tỷ suất cổ tức (thập phân, vd 0.03 = 3%) */
  dividendYield: number | null;
  /** Payout ước tính (thập phân) nếu suy được */
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

/** Căn chỉnh 2 chuỗi theo độ dài chung (cùng số phiên gần nhất) */
function alignTail(a: number[], b: number[]): [number[], number[]] {
  const n = Math.min(a.length, b.length);
  if (n < 3) return [[], []];
  return [a.slice(a.length - n), b.slice(b.length - n)];
}

const RF_ANNUAL = 0.05; // lãi phi rủi ro ước ~5%/năm VN

export function computeInvestmentPerformance(opts: {
  closes: number[];
  indexCloses?: number[] | null;
  dividendYield?: number | null;
  /** LNST kỳ gần (VND) + DPS*shares nếu có — payout */
  netIncome?: number | null;
  annualDividendCash?: number | null;
}): PerformanceMetrics {
  const closes = opts.closes.filter((c) => Number.isFinite(c) && c > 0);
  const idxRaw = (opts.indexCloses ?? []).filter((c) => Number.isFinite(c) && c > 0);

  const empty: PerformanceMetrics = {
    tsr: null,
    tsr1y: null,
    beta: null,
    sharpe: null,
    alpha: null,
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

  // ~252 phiên ≈ 1 năm giao dịch
  let tsr1y: number | null = null;
  if (closes.length >= 40) {
    const look = Math.min(252, closes.length - 1);
    const a = closes[closes.length - 1 - look]!;
    const z = closes[closes.length - 1]!;
    if (a > 0) tsr1y = (z - a) / a;
  }

  const rets = dailyReturns(closes);
  const mu = mean(rets);
  const sd = stdev(rets);
  let sharpe: number | null = null;
  if (mu != null && sd != null && sd > 1e-12 && rets.length >= 20) {
    const excessAnn = mu * 252 - RF_ANNUAL;
    sharpe = excessAnn / (sd * Math.sqrt(252));
  }

  let beta: number | null = null;
  let alpha: number | null = null;
  // Ngưỡng thấp hơn cho mã mới IPO (≥20 return pairs ≈ 21 phiên)
  const minPairs = 20;
  if (idxRaw.length >= minPairs + 1 && closes.length >= minPairs + 1) {
    const [sc, ic] = alignTail(closes, idxRaw);
    const rs = dailyReturns(sc);
    const rm = dailyReturns(ic);
    const n = Math.min(rs.length, rm.length);
    if (n >= minPairs) {
      const a = rs.slice(rs.length - n);
      const b = rm.slice(rm.length - n);
      const cov = covariance(a, b);
      const varM = variance(b);
      if (cov != null && varM != null && varM > 1e-14) {
        beta = cov / varM;
        const ms = mean(a);
        const mm = mean(b);
        if (ms != null && mm != null) {
          alpha = (ms - RF_ANNUAL / 252 - beta * (mm - RF_ANNUAL / 252)) * 252;
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
  else notes.push(`rf≈${(RF_ANNUAL * 100).toFixed(0)}%`);
  if (dy == null) notes.push("Chưa có DIVIDEND_YIELD từ ratios");

  return {
    tsr: clamp(tsr, -0.99, 20),
    tsr1y: clamp(tsr1y, -0.99, 20),
    beta: clamp(beta, -3, 5),
    sharpe: clamp(sharpe, -5, 8),
    alpha: clamp(alpha, -2, 5),
    dividendYield: dy != null && dy >= 0 && dy < 0.5 ? dy : null,
    payoutRatio: clamp(payoutRatio, 0, 2),
    sampleDays: closes.length,
    indexSampleDays: idxRaw.length,
    note: notes.join(" · "),
  };
}
