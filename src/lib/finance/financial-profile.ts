import {
  computeAssetAllocation,
  computeCashFlow,
  computeConcentration,
  computeCurrencyExposure,
  computeDebtToIncome,
  computeEmergencyFundCoverage,
  computeFinancialHealth,
  computeGoalProgress,
  computeLeverageRatio,
  computeLiquidityRatio,
  computeNetWorth,
  computeSavingsRate,
  computeSectorExposure,
  projectGoal,
  requiredMonthlySaving,
  type Holding,
} from "./financial-math";

/**
 * FINANCIAL PROFILE — mô hình dữ liệu tài chính cá nhân.
 * - Validation deterministic: field không hợp lệ bị loại (không đoán, không sửa âm thầm).
 * - derive(): mọi chỉ số đều chứa `available` — thiếu dữ liệu → null chứ không phạt 0.
 * - Đây là nguồn chính thức cho Personal Finance Agent & Wealth Manager.
 */

export const RISK_PROFILES = ["conservative", "balanced", "growth"] as const;
export type RiskProfile = (typeof RISK_PROFILES)[number];

export interface FinancialGoal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number | null;
  monthlyContribution: number | null;
  annualReturnPct: number | null;
  targetYear: number | null; // năm dương lịch dự kiến
  createdAt?: string;
}

/** Input chưa sạch — chấp nhận chuỗi VN ("30,000,000 đ") từ chat/API. */
export interface RawProfileInput {
  birthYear?: number | string | null;
  monthlyIncome?: number | string | null;
  monthlyExpenses?: number | string | null;
  monthlyDebtPayments?: number | string | null;
  liquidAssets?: number | string | null;
  totalAssets?: number | string | null;
  totalLiabilities?: number | string | null;
  emergencyTargetMonths?: number | string | null;
  riskProfile?: RiskProfile | string | null;
  goals?: (Omit<FinancialGoal, "targetAmount" | "currentAmount" | "monthlyContribution" | "annualReturnPct" | "targetYear"> & {
    targetAmount?: number | string | null;
    currentAmount?: number | string | null;
    monthlyContribution?: number | string | null;
    annualReturnPct?: number | string | null;
    targetYear?: number | string | null;
  })[];
  holdings?: (Partial<Holding> & { id?: string; label?: string; value?: number | string | null })[];
}

/** Input đã chuẩn hóa (chỉ chứa số hợp lệ). */
export interface FinancialProfileInput {
  birthYear: number | null;
  monthlyIncome: number | null;
  monthlyExpenses: number | null;
  monthlyDebtPayments: number | null;
  liquidAssets: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
  emergencyTargetMonths: number | null;
  riskProfile: RiskProfile | null;
  goals: FinancialGoal[];
  holdings: Holding[];
}

export interface ProfileFieldErrors {
  [field: string]: string[] | undefined;
}

export interface Value<T> {
  value: T | null;
  available: boolean;
}

export interface GoalComputed {
  goal: FinancialGoal;
  achievedValue: number | null; // current + contributions
  progressPct: Value<number>; // 0..1
  yearsLeft: Value<number>;
  projectedValue: Value<number>;
  requiredMonthlySaving: Value<number>; // if targetYear given
  onTrack: Value<boolean>; // projected >= target
}

export interface DerivedProfile {
  age: Value<number>;
  cashFlow: { freeCashFlow: Value<number>; income: Value<number>; expenses: Value<number> };
  netWorth: { value: Value<number> };
  savingsRate: Value<number>; // 0..1
  debtToIncome: Value<number>; // 0..1
  emergencyFund: Value<number>; // tháng
  liquidityRatio: Value<number>; // 0..1
  leverageRatio: Value<number>; // 0..1
  health: ReturnType<typeof computeFinancialHealth>;
  allocation: ReturnType<typeof computeAssetAllocation>;
  concentration: ReturnType<typeof computeConcentration>;
  sectorExposure: ReturnType<typeof computeSectorExposure>;
  currencyExposure: ReturnType<typeof computeCurrencyExposure>;
  goals: GoalComputed[];
}

export interface FinancialProfile {
  inputs: FinancialProfileInput;
  errors: ProfileFieldErrors;
  valid: boolean; // không có lỗi field (có thể vẫn thiếu dữ liệu)
  completeness: number; // 0..1 — tỷ lệ field cốt lõi có dữ liệu
  derive: DerivedProfile;
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(cleanNumberString(String(v)));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const numStrict = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(cleanNumberString(String(v)));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** normalize "30,000,000 đ" / "30.000.000" → "30000000"; chuỗi rác → NaN */
function cleanNumberString(s: string): string {
  let out = s.replace(/[.,\s]/g, (m) => (m === "," ? "" : m)).replace(/[^\d.-]/g, "");
  if (out === "" || out === "." || out === "-" || out === "-.") return "NaN";
  return out;
}

const v = (value: number | null): Value<number> => ({ value, available: value != null });
const vb = (value: boolean | null): Value<boolean> => ({ value, available: value != null });

function validateGoal(g: FinancialGoal, errors: ProfileFieldErrors, idx: number): boolean {
  const key = `goals[${idx}]`;
  let ok = true;
  const push = (f: string, msg: string) => {
    errors[`${key}.${f}`] = [...(errors[`${key}.${f}`] ?? []), msg];
    ok = false;
  };
  if (!g.id || !g.name) push("id", "Goal cần id và tên");
  if (numStrict(g.targetAmount) == null) push("targetAmount", "Số tiền mục tiêu phải là số dương");
  if (g.currentAmount != null && num(g.currentAmount) == null) push("currentAmount", "Số tiền hiện có không hợp lệ");
  if (g.monthlyContribution != null && num(g.monthlyContribution) == null) push("monthlyContribution", "Góp hàng tháng không hợp lệ");
  if (g.annualReturnPct != null) {
    const r = num(g.annualReturnPct);
    if (r == null || r > 30) push("annualReturnPct", "Lợi suất kỳ vọng phải từ 0–30%/năm");
  }
  if (g.targetYear != null) {
    const y = g.targetYear;
    const now = new Date().getFullYear();
    if (!Number.isInteger(y) || y < now || y > now + 60) push("targetYear", "Năm mục tiêu phải trong tương lai (≤ 60 năm)");
  }
  return ok;
}

const DEFAULT_EMERGENCY_TARGET = 6;
const CORE_FIELDS = [
  "monthlyIncome",
  "monthlyExpenses",
  "monthlyDebtPayments",
  "liquidAssets",
  "totalAssets",
  "totalLiabilities",
] as const;

/** Chuẩn hóa + validate input — trường sai sẽ bị loại khỏi inputs (không đoán). */
export function buildFinancialProfile(input: RawProfileInput = {}): FinancialProfile {
  const errors: ProfileFieldErrors = {};
  const push = (field: string, msg: string) => {
    errors[field] = [...(errors[field] ?? []), msg];
  };

  const pickMoney = (k: keyof RawProfileInput & keyof FinancialProfileInput, label: string): number | null => {
    const raw = input[k];
    if (raw == null || raw === "") return null;
    const n = num(raw);
    if (n == null) {
      push(k, `${label} không hợp lệ (phải là số không âm)`);
      return null;
    }
    return n;
  };

  let birthYear: number | null = null;
  if (input.birthYear != null && input.birthYear !== "") {
    const y = Math.trunc(Number(String(input.birthYear).replace(/[^\d.-]/g, "")));
    const nowY = new Date().getFullYear();
    if (Number.isInteger(y) && y >= nowY - 100 && y <= nowY - 16) birthYear = y;
    else push("birthYear", "Năm sinh phải trong khoảng 16–100 tuổi");
  }

  const monthlyIncome = pickMoney("monthlyIncome", "Thu nhập hàng tháng");
  const monthlyExpenses = pickMoney("monthlyExpenses", "Chi tiêu hàng tháng");
  const monthlyDebtPayments = pickMoney("monthlyDebtPayments", "Trả nợ hàng tháng");
  const liquidAssets = pickMoney("liquidAssets", "Tài sản thanh khoản");
  const totalAssets = pickMoney("totalAssets", "Tổng tài sản");
  const totalLiabilities = pickMoney("totalLiabilities", "Tổng nợ");

  if (incomeOverExpenses(monthlyIncome, monthlyExpenses)) {
    // ghi chú ở derive (không phải lỗi cứng)
  }

  let emergencyTargetMonths: number | null = null;
  const rawTarget = input.emergencyTargetMonths;
  if (rawTarget != null) {
    const t = numStrict(rawTarget);
    if (t == null || t > 60) push("emergencyTargetMonths", "Ngưỡng quỹ khẩn cấp phải từ 1–60 tháng");
    else emergencyTargetMonths = t;
  }

  let riskProfile: RiskProfile | null = null;
  if (input.riskProfile != null && input.riskProfile !== "") {
    const rp = String(input.riskProfile).toLowerCase();
    if (RISK_PROFILES.includes(rp as RiskProfile)) riskProfile = rp as RiskProfile;
    else push("riskProfile", `riskProfile phải là ${RISK_PROFILES.join(" | ")}`);
  }

  const goals: FinancialGoal[] = [];
  for (const [i, g] of (input.goals ?? []).entries()) {
    if (!g || typeof g !== "object") {
      push(`goals[${i}]`, "Goal không hợp lệ");
      continue;
    }
    const rz = g as Record<string, unknown>;
    const cleaned: FinancialGoal = {
      id: String(g.id ?? `goal-${i}`),
      name: String(g.name ?? `Mục tiêu ${i + 1}`),
      targetAmount: numStrict(rz.targetAmount) ?? 0,
      currentAmount: rz.currentAmount != null ? num(rz.currentAmount) : null,
      monthlyContribution: rz.monthlyContribution != null ? num(rz.monthlyContribution) : null,
      annualReturnPct: rz.annualReturnPct != null ? num(rz.annualReturnPct) : null,
      targetYear: rz.targetYear != null ? Math.trunc(Number(String(rz.targetYear).replace(/[^\d.-]/g, ""))) : null,
      createdAt: g.createdAt,
    };
    if (validateGoal(cleaned, errors, i)) goals.push(cleaned);
  }

  // Holdings: id+label bắt buộc, value > 0, assetClass enum mềm (key tùy ý nhưng phải là chuỗi)
  const holdings: Holding[] = [];
  for (const [i, h] of (input.holdings ?? []).entries()) {
    const key = `holdings[${i}]`;
    if (!h || typeof h !== "object" || !h.id || !h.label) {
      push(key, "Holding cần id và label");
      continue;
    }
    const value = numStrict(h.value);
    if (value == null) {
      push(`${key}.value`, "Giá trị holding phải là số dương");
      continue;
    }
    holdings.push({
      id: String(h.id),
      label: String(h.label),
      assetClass: String(h.assetClass ?? "other"),
      value,
      sector: h.sector != null ? String(h.sector) : null,
      currency: h.currency != null ? String(h.currency) : null,
    });
  }

  const inputs: FinancialProfileInput = {
    birthYear,
    monthlyIncome,
    monthlyExpenses,
    monthlyDebtPayments,
    liquidAssets,
    totalAssets,
    totalLiabilities,
    emergencyTargetMonths,
    riskProfile,
    goals,
    holdings,
  };

  const derive = deriveProfile(inputs);
  const coreReady = CORE_FIELDS.filter((f) => inputs[f] != null).length;
  const completeness = CORE_FIELDS.length ? coreReady / CORE_FIELDS.length : 0;
  const valid = Object.keys(errors).length === 0;

  return { inputs, errors, valid, completeness, derive };
}

function incomeOverExpenses(income: number | null, expenses: number | null): boolean {
  return income != null && expenses != null && expenses > income * 1.5;
}

/** Tính toán mọi chỉ số từ input đã chuẩn hóa (thuần, deterministic). */
export function deriveProfile(inputs: FinancialProfileInput): DerivedProfile {
  const nowY = new Date().getFullYear();
  const age = inputs.birthYear != null ? nowY - inputs.birthYear : null;

  const cf = computeCashFlow(inputs.monthlyIncome, inputs.monthlyExpenses);
  const nw = computeNetWorth(inputs.totalAssets, inputs.totalLiabilities);
  const savingsRate = cf.freeCashFlow != null ? computeSavingsRate(cf.freeCashFlow, inputs.monthlyIncome) : null;
  const dti = computeDebtToIncome(inputs.monthlyDebtPayments, inputs.monthlyIncome);
  const emergency = computeEmergencyFundCoverage(inputs.liquidAssets, inputs.monthlyExpenses);
  const liquidity = computeLiquidityRatio(inputs.liquidAssets, inputs.totalAssets);
  const leverage = computeLeverageRatio(inputs.totalLiabilities, inputs.totalAssets);

  const health = computeFinancialHealth({
    monthlyIncome: inputs.monthlyIncome,
    monthlyExpenses: inputs.monthlyExpenses,
    monthlyDebtPayments: inputs.monthlyDebtPayments,
    liquidAssets: inputs.liquidAssets,
    totalAssets: inputs.totalAssets,
    totalLiabilities: inputs.totalLiabilities,
    emergencyTargetMonths: inputs.emergencyTargetMonths ?? DEFAULT_EMERGENCY_TARGET,
  });

  const allocation = computeAssetAllocation(inputs.holdings);
  const concentration = computeConcentration(inputs.holdings);
  const sectorExposure = computeSectorExposure(inputs.holdings);
  const currencyExposure = computeCurrencyExposure(inputs.holdings);

  const goals: GoalComputed[] = inputs.goals.map((g) => {
    const yearsLeft = g.targetYear != null ? Math.max(0, g.targetYear - new Date().getFullYear()) : null;
    const projected = projectGoal(g.currentAmount, g.monthlyContribution, g.annualReturnPct, yearsLeft);
    return {
      goal: g,
      achievedValue: g.currentAmount,
      progressPct: v(computeGoalProgress(g.currentAmount, g.targetAmount)),
      yearsLeft: v(yearsLeft),
      projectedValue: v(projected?.futureValue ?? null),
      requiredMonthlySaving: v(requiredMonthlySavingForGoal(g)),
      onTrack: vb(projected?.futureValue != null && g.targetAmount != null ? projected.futureValue >= g.targetAmount : null),
    };
  });

  return {
    age: v(age),
    cashFlow: { freeCashFlow: v(cf.freeCashFlow), income: v(cf.income), expenses: v(cf.expenses) },
    netWorth: { value: v(nw.netWorth) },
    savingsRate: v(savingsRate),
    debtToIncome: v(dti),
    emergencyFund: v(emergency),
    liquidityRatio: v(liquidity),
    leverageRatio: v(leverage),
    health,
    allocation,
    concentration,
    sectorExposure,
    currencyExposure,
    goals,
  };
}

/** Số tiền góp hàng tháng cần thiết để đạt goal đúng hạn (dùng math engine). */
function requiredMonthlySavingForGoal(g: FinancialGoal): number | null {
  const y = g.targetYear != null ? Math.max(0, g.targetYear - new Date().getFullYear()) : null;
  const r = requiredMonthlySaving(g.targetAmount, g.currentAmount, g.annualReturnPct, y);
  return r?.monthly ?? null;
}
