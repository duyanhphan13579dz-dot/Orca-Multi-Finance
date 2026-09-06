/**
 * ORCA FINANCIAL MATH ENGINE — thuần, deterministic, test được.
 * Mọi hàm trả `null` khi input thiếu/không hợp lệ (KHÔNG đoán, KHÔNG trả 0 giả).
 * Dùng cho cả 3 agent (personal finance, wealth management, scenario tools)
 * và cho deterministic narrative — LLM chỉ nhận kết quả đã tính.
 */

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const numOrZero = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);
const pct = (x: number | null): number | null => (x == null ? null : x * 100);

/* ------------------------------ cash flow --------------------------------- */

export function computeCashFlow(monthlyIncome: number | null, monthlyExpenses: number | null): {
  income: number | null;
  expenses: number | null;
  freeCashFlow: number | null;
} {
  const income = numOrZero(monthlyIncome);
  const expenses = numOrZero(monthlyExpenses);
  if (income == null && expenses == null) return { income: null, expenses: null, freeCashFlow: null };
  const freeCashFlow = income != null && expenses != null ? income - expenses : null;
  return { income, expenses, freeCashFlow };
}

/* ------------------------------- net worth -------------------------------- */

export function computeNetWorth(totalAssets: number | null, totalLiabilities: number | null): {
  totalAssets: number | null;
  totalLiabilities: number | null;
  netWorth: number | null;
} {
  const assets = numOrZero(totalAssets);
  const liabilities = numOrZero(totalLiabilities);
  if (assets == null && liabilities == null) return { totalAssets: null, totalLiabilities: null, netWorth: null };
  const netWorth = assets != null && liabilities != null ? assets - liabilities : null;
  return { totalAssets: assets, totalLiabilities: liabilities, netWorth };
}

/** Tỷ lệ tiết kiệm = dòng tiền tự do / thu nhập (chỉ khi có đủ 2 số). */
export function computeSavingsRate(freeCashFlow: number | null, grossIncome: number | null): number | null {
  const f = numOrZero(freeCashFlow);
  const g = num(grossIncome);
  if (f == null || g == null) return null;
  return f / g;
}

/** DTI = tổng trả nợ hàng tháng / thu nhập gộp hàng tháng (0..1). */
export function computeDebtToIncome(totalMonthlyDebtPayments: number | null, grossMonthlyIncome: number | null): number | null {
  const p = numOrZero(totalMonthlyDebtPayments);
  const g = num(grossMonthlyIncome);
  if (p == null || g == null) return null;
  return p / g;
}

/** Độ phủ quỹ khẩn cấp = tài sản thanh khoản / chi tiêu hàng tháng (tháng). */
export function computeEmergencyFundCoverage(liquidAssets: number | null, monthlyExpenses: number | null): number | null {
  const l = numOrZero(liquidAssets);
  const e = num(monthlyExpenses);
  if (l == null || e == null) return null;
  return l / e;
}

/** Tỷ lệ thanh khoản = tài sản thanh khoản / tổng tài sản (0..1). */
export function computeLiquidityRatio(liquidAssets: number | null, totalAssets: number | null): number | null {
  const l = numOrZero(liquidAssets);
  const a = num(totalAssets);
  if (l == null || a == null) return null;
  return l / a;
}

/** Đòn bẩy = nợ / tài sản (0..1). */
export function computeLeverageRatio(totalLiabilities: number | null, totalAssets: number | null): number | null {
  const l = numOrZero(totalLiabilities);
  const a = num(totalAssets);
  if (l == null || a == null) return null;
  return l / a;
}

/* --------------------------- financial health ----------------------------- */

export interface FinancialHealthInput {
  monthlyIncome: number | null;
  monthlyExpenses: number | null;
  monthlyDebtPayments: number | null;
  liquidAssets: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
  /** ngưỡng kỳ vọng cho điểm số (mặc định 6 tháng) */
  emergencyTargetMonths?: number;
}

export interface HealthMetric {
  value: number | null;
  score: number | null; // 0..100
  status: "GOOD" | "WATCH" | "POOR" | "UNAVAILABLE";
  note: string;
}

export interface FinancialHealthScore {
  overall: number | null;
  level: "STRONG" | "OK" | "WEAK" | "CRITICAL" | "UNAVAILABLE";
  metrics: { savingsRate: HealthMetric; debtToIncome: HealthMetric; emergencyFund: HealthMetric; liquidity: HealthMetric; leverage: HealthMetric };
}

/**
 * Chấm điểm minh bạch (weighted, 0-100):
 *  savingsRate 30%+ → 100, 0% → 0 (25%)
 *  DTI ≤ 20% → 100, ≥ 50% → 0 (25%)
 *  quỹ khẩn cấp ≥ 6 tháng → 100, 0 → 0 (20%)
 *  thanh khoản ≥ 30% → 100, 0 → 0 (15%)
 *  đòn bẩy ≤ 40% → 100, ≥ 90% → 0 (15%)
 * Thiếu dữ liệu → metric UNAVAILABLE, không gán điểm 0 (không phạt vô cớ).
 */
export function computeFinancialHealth(input: FinancialHealthInput): FinancialHealthScore {
  const cf = computeCashFlow(input.monthlyIncome, input.monthlyExpenses);
  const savingsRate = cf.freeCashFlow != null ? computeSavingsRate(cf.freeCashFlow, input.monthlyIncome) : null;
  const dti = computeDebtToIncome(input.monthlyDebtPayments, input.monthlyIncome);
  const emergency = computeEmergencyFundCoverage(input.liquidAssets, input.monthlyExpenses);
  const liquidity = computeLiquidityRatio(input.liquidAssets, input.totalAssets);
  const leverage = computeLeverageRatio(input.totalLiabilities, input.totalAssets);

  const metric = (value: number | null, score: number | null, status: HealthMetric["status"], note: string): HealthMetric => ({
    value,
    score,
    status,
    note,
  });

  const savings = {
    value: pct(savingsRate),
    score: savingsRate != null ? clamp((savingsRate - 0) / 0.3, 0, 1) * 100 : null,
    status: savingsRate == null ? "UNAVAILABLE" : savingsRate >= 0.3 ? "GOOD" : savingsRate >= 0.1 ? "WATCH" : "POOR",
    note: savingsRate == null ? "Chưa đủ dữ liệu thu nhập/chi tiêu" : `Tiết kiệm ${(savingsRate * 100).toFixed(0)}% thu nhập`,
  } as HealthMetric;

  const debt = {
    value: pct(dti),
    score: dti != null ? clamp(1 - (dti - 0.2) / 0.3, 0, 1) * 100 : null,
    status: dti == null ? "UNAVAILABLE" : dti <= 0.2 ? "GOOD" : dti <= 0.36 ? "WATCH" : "POOR",
    note: dti == null ? "Chưa đủ dữ liệu trả nợ" : `Trả nợ ${(dti * 100).toFixed(0)}% thu nhập`,
  } as HealthMetric;

  const target = input.emergencyTargetMonths ?? 6;
  const eFund = {
    value: emergency,
    score: emergency != null ? clamp(emergency / target, 0, 1) * 100 : null,
    status: emergency == null ? "UNAVAILABLE" : emergency >= target ? "GOOD" : emergency >= target / 2 ? "WATCH" : "POOR",
    note: emergency == null ? "Chưa đủ dữ liệu quỹ khẩn cấp" : `Quỹ khẩn cấp ${emergency.toFixed(1)}/${target} tháng`,
  } as HealthMetric;

  const liq = {
    value: pct(liquidity),
    score: liquidity != null ? clamp(liquidity / 0.3, 0, 1) * 100 : null,
    status: liquidity == null ? "UNAVAILABLE" : liquidity >= 0.3 ? "GOOD" : liquidity >= 0.15 ? "WATCH" : "POOR",
    note: liquidity == null ? "Chưa đủ dữ liệu tài sản" : `Thanh khoản ${(liquidity * 100).toFixed(0)}% tài sản`,
  } as HealthMetric;

  const lev = {
    value: pct(leverage),
    score: leverage != null ? clamp(1 - (leverage - 0.4) / 0.5, 0, 1) * 100 : null,
    status: leverage == null ? "UNAVAILABLE" : leverage <= 0.4 ? "GOOD" : leverage <= 0.7 ? "WATCH" : "POOR",
    note: leverage == null ? "Chưa đủ dữ liệu nợ" : `Đòn bẩy ${(leverage * 100).toFixed(0)}% tài sản`,
  } as HealthMetric;

  const weighted: [HealthMetric, number][] = [
    [savings, 0.25],
    [debt, 0.25],
    [eFund, 0.2],
    [liq, 0.15],
    [lev, 0.15],
  ];
  const available = weighted.filter(([m]) => m.score != null);
  const overall = available.length ? Math.round(available.reduce((a, [m, w]) => a + (m.score ?? 0) * w, 0) / available.reduce((a, [, w]) => a + w, 0)) : null;
  const level: FinancialHealthScore["level"] =
    overall == null ? "UNAVAILABLE" : overall >= 75 ? "STRONG" : overall >= 50 ? "OK" : overall >= 30 ? "WEAK" : "CRITICAL";

  return { overall, level, metrics: { savingsRate: savings, debtToIncome: debt, emergencyFund: eFund, liquidity: liq, leverage: lev } };
}

/* -------------------------------- goals ----------------------------------- */

/** Giá trị tương lai với góp hàng tháng (FV annuity, lãi kép tháng). */
export function projectGoal(
  currentAmount: number | null,
  monthlyContribution: number | null,
  annualReturnPct: number | null,
  years: number | null,
): { futureValue: number; contributed: number; growth: number } | null {
  const cur = numOrZero(currentAmount);
  const monthly = numOrZero(monthlyContribution);
  const r = numOrZero(annualReturnPct) != null ? Number(annualReturnPct) / 100 : null;
  const y = num(years);
  if ((cur == null && monthly == null) || r == null || y == null) return null;
  const n = y * 12;
  const i = r / 12;
  const fvCur = (cur ?? 0) * (1 + i) ** n;
  const fvAnnuity = i > 0 ? (monthly ?? 0) * (((1 + i) ** n - 1) / i) : (monthly ?? 0) * n;
  const futureValue = fvCur + fvAnnuity;
  const contributed = (cur ?? 0) + (monthly ?? 0) * n;
  return { futureValue, contributed, growth: futureValue - contributed };
}

/** Số tiền cần góp mỗi tháng để đạt mục tiêu (giải ngược FV annuity). */
export function requiredMonthlySaving(
  targetAmount: number | null,
  currentAmount: number | null,
  annualReturnPct: number | null,
  years: number | null,
): { monthly: number; totalContribution: number } | null {
  const target = num(targetAmount);
  const cur = numOrZero(currentAmount);
  const r = numOrZero(annualReturnPct) != null ? Number(annualReturnPct) / 100 : null;
  const y = num(years);
  if (target == null || r == null || y == null) return null;
  const n = y * 12;
  const i = r / 12;
  const targetGap = target - (cur ?? 0) * (1 + i) ** n;
  if (targetGap <= 0) return { monthly: 0, totalContribution: 0 };
  const monthly = i > 0 ? targetGap / (((1 + i) ** n - 1) / i) : targetGap / n;
  return { monthly, totalContribution: monthly * n };
}

/** Tiến độ mục tiêu = đã góp / mục tiêu (0..1). */
export function computeGoalProgress(contributedAmount: number | null, targetAmount: number | null): number | null {
  const c = numOrZero(contributedAmount);
  const t = num(targetAmount);
  if (c == null || t == null) return null;
  return c / t;
}

/* ------------------------------- portfolio -------------------------------- */

export type AssetClassKey = "cash" | "stocks" | "bonds" | "gold" | "realEstate" | "crypto" | "other";

export interface Holding {
  id: string;
  label: string;
  assetClass: AssetClassKey | string;
  value: number;
  sector?: string | null;
  currency?: string | null;
}

const ASSET_CLASS_LABEL: Record<string, string> = {
  cash: "Tiền mặt",
  stocks: "Cổ phiếu",
  bonds: "Trái phiếu",
  gold: "Vàng",
  realEstate: "Bất động sản",
  crypto: "Crypto",
  other: "Tài sản khác",
};

export function assetClassLabel(key: string): string {
  return ASSET_CLASS_LABEL[key] ?? key;
}

export interface AllocationRow {
  key: AssetClassKey | string;
  label: string;
  value: number;
  weightPct: number;
}

/** Phân bổ tài sản theo lớp (tổng = sum giá trị holdings). */
export function computeAssetAllocation(holdings: Holding[]): { rows: AllocationRow[]; total: number } | null {
  if (!holdings.length) return null;
  const byClass = new Map<string, number>();
  for (const h of holdings) {
    const v = numOrZero(h.value);
    if (v == null) continue;
    byClass.set(h.assetClass, (byClass.get(h.assetClass) ?? 0) + v);
  }
  const total = [...byClass.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const rows = [...byClass.entries()]
    .map(([key, value]) => ({ key, label: assetClassLabel(key), value, weightPct: (value / total) * 100 }))
    .sort((a, b) => b.value - a.value);
  return { rows, total };
}

export interface Concentration {
  hhi: number | null; // 0..10000 — chỉ số tập trung Herfindahl
  top1Pct: number | null;
  top3Pct: number | null;
  largest: { id: string; label: string; weightPct: number } | null;
  holdingsCount: number;
  level: "DIVERSIFIED" | "MODERATE" | "CONCENTRATED" | "UNAVAILABLE";
}

/** Rủi ro tập trung: HHI + top1 theo giá trị từng holding.
 *  CONCENTRATED: HHI > 3200 hoặc top1 ≥ 50%; MODERATE: HHI ≥ 1500 hoặc top1 ≥ 25%.
 */
export function computeConcentration(holdings: Holding[]): Concentration {
  if (!holdings.length) return { hhi: null, top1Pct: null, top3Pct: null, largest: null, holdingsCount: 0, level: "UNAVAILABLE" };
  const values = holdings.map((h) => numOrZero(h.value)).filter((v): v is number => v != null);
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return { hhi: null, top1Pct: null, top3Pct: null, largest: null, holdingsCount: holdings.length, level: "UNAVAILABLE" };
  const sorted = [...holdings.filter((h) => numOrZero(h.value) != null)].sort((a, b) => (numOrZero(b.value) ?? 0) - (numOrZero(a.value) ?? 0));
  const weights = sorted.map((h) => (numOrZero(h.value) ?? 0) / total);
  const hhi = Math.round(weights.reduce((a, w) => a + w * w, 0) * 10_000);
  const top1Pct = weights[0] * 100;
  const top3Pct = weights.slice(0, 3).reduce((a, w) => a + w, 0) * 100;
  const level: Concentration["level"] = top1Pct >= 50 ? "CONCENTRATED" : hhi >= 1500 || top1Pct >= 25 ? "MODERATE" : "DIVERSIFIED";
  return {
    hhi,
    top1Pct,
    top3Pct,
    largest: { id: sorted[0].id, label: sorted[0].label, weightPct: top1Pct },
    holdingsCount: holdings.length,
    level,
  };
}

export function computeSectorExposure(holdings: Holding[]): { rows: { sector: string; value: number; weightPct: number }[]; total: number } | null {
  const withSector = holdings.filter((h) => h.sector && numOrZero(h.value) != null);
  if (!withSector.length) return null;
  const bySector = new Map<string, number>();
  for (const h of withSector) bySector.set(h.sector as string, (bySector.get(h.sector as string) ?? 0) + (numOrZero(h.value) ?? 0));
  const total = [...bySector.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  return {
    rows: [...bySector.entries()].map(([sector, value]) => ({ sector, value, weightPct: (value / total) * 100 })).sort((a, b) => b.value - a.value),
    total,
  };
}

export function computeCurrencyExposure(holdings: Holding[]): { rows: { currency: string; value: number; weightPct: number }[]; total: number } | null {
  const withCc = holdings.filter((h) => h.currency && numOrZero(h.value) != null);
  if (!withCc.length) return null;
  const byCc = new Map<string, number>();
  for (const h of withCc) byCc.set(h.currency as string, (byCc.get(h.currency as string) ?? 0) + (numOrZero(h.value) ?? 0));
  const total = [...byCc.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  return {
    rows: [...byCc.entries()].map(([currency, value]) => ({ currency, value, weightPct: (value / total) * 100 })).sort((a, b) => b.value - a.value),
    total,
  };
}

/** Lợi suất danh mục có trọng số (mỗi holding cần returnPct). */
export function computePortfolioReturn(holdings: { value: number; returnPct: number | null }[]): { weightedReturnPct: number | null; provided: number; missing: number } {
  const values = holdings.map((h) => numOrZero(h.value)).filter((v): v is number => v != null);
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return { weightedReturnPct: null, provided: 0, missing: holdings.length };
  let weighted = 0;
  let provided = 0;
  let missing = 0;
  for (const h of holdings) {
    const v = numOrZero(h.value);
    if (v == null) continue;
    if (h.returnPct == null || !Number.isFinite(h.returnPct)) {
      missing += 1;
      continue;
    }
    weighted += (v / total) * h.returnPct;
    provided += 1;
  }
  return { weightedReturnPct: provided ? weighted : null, provided, missing };
}

/** Drawdown tối đa từ chuỗi giá (tỷ lệ, 0..1 — giá trị dương = mức giảm). */
export function computeMaxDrawdown(prices: number[]): number | null {
  const clean = prices.filter((p) => Number.isFinite(p) && p > 0);
  if (clean.length < 2) return null;
  let peak = clean[0];
  let maxDd = 0;
  for (const p of clean) {
    if (p > peak) peak = p;
    const dd = (peak - p) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

/**
 * Chặn trên rủi ro danh mục (giả định tương quan = 1) — mathematically là CẬN TRÊN
 * của volatility tổ hợp. KHÔNG phải ước lượng chính xác; ghi nhãn "model inference
 * (cận trên)". Cần vol từng class — thiếu → null.
 */
export function computePortfolioRiskProxy(holdings: { value: number; volatilityPct: number | null }[]): {
  worstCaseVolPct: number | null;
  note: string;
} {
  const values = holdings.map((h) => numOrZero(h.value)).filter((v): v is number => v != null);
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return { worstCaseVolPct: null, note: "Chưa đủ dữ liệu" };
  let weighted = 0;
  let missing = 0;
  for (const h of holdings) {
    const v = numOrZero(h.value);
    if (v == null) continue;
    if (h.volatilityPct == null || !Number.isFinite(h.volatilityPct)) {
      missing += 1;
      continue;
    }
    weighted += (v / total) * Math.abs(h.volatilityPct);
  }
  return {
    worstCaseVolPct: missing === holdings.length ? null : weighted,
    note: "Cận trên rủi ro (giả định tương quan 1 giữa các tài sản) — model inference, không phải đo lường chính xác",
  };
}

/* ------------------------------- scenarios -------------------------------- */

export interface ScenarioShock {
  assetClass: string;
  shockPct: number; // e.g. -10 = giảm 10%
}

export function runPortfolioScenario(holdings: Holding[], shocks: ScenarioShock[]): {
  before: number;
  after: number;
  changePct: number | null;
  perClass: { key: string; before: number; after: number; changePct: number | null }[];
} | null {
  const values = holdings.map((h) => numOrZero(h.value)).filter((v): v is number => v != null);
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const byClass = new Map<string, number>();
  for (const h of holdings) byClass.set(h.assetClass, (byClass.get(h.assetClass) ?? 0) + (numOrZero(h.value) ?? 0));
  const shock = new Map(shocks.map((s) => [s.assetClass, s.shockPct / 100]));
  const perClass = [...byClass.entries()].map(([key, before]) => {
    const s = shock.get(key) ?? 0;
    const after = before * (1 + s);
    return { key, before, after, changePct: (after - before) / before * 100 };
  });
  const before = total;
  const after = perClass.reduce((a, r) => a + r.after, 0);
  return { before, after, changePct: (after - before) / before * 100, perClass };
}
