/**
 * Storage & State Management for Orca Personal Finance
 * Tuân thủ B4 (mô hình dữ liệu) & B7 (quyền riêng tư, xuất/xóa dữ liệu).
 */

import {
  FinanceProfile,
  MonthlySnapshot,
  ExpenseItem,
  AssetItem,
  DebtItem,
  FinancialGoal,
  AssumptionSet,
  CalculatedMetrics,
  Insight,
} from '../types/finance.ts';
import { calculateTaxVn } from '../engines/taxVnEngine.ts';
import { calculateCashflow } from '../engines/cashflowEngine.ts';
import { calculateNetworth } from '../engines/networthEngine.ts';
import { calculateHealthScore } from '../engines/healthScoreEngine.ts';
import { generateQuantitativeAdvice } from '../engines/adviceEngine.ts';
import { DEFAULT_ASSUMPTIONS } from '../engines/projectionEngine.ts';

const STORAGE_KEY_PROFILE = 'orca_fin_profile_v1';
const STORAGE_KEY_SNAPSHOTS = 'orca_fin_snapshots_v1';
const STORAGE_KEY_ASSUMPTIONS = 'orca_fin_assumptions_v1';

export const INITIAL_EMPTY_PROFILE: FinanceProfile = {
  birthYear: 1996,
  maritalStatus: 'single',
  dependentsCount: 0,
  employmentType: 'salaried',
  riskTolerance: 'moderate',
  consentStorage: true,
  consentAI: true,
  consentOpenBanking: false,
  updatedAt: '06/10/2026',
};

// ==========================================
// DEMO DATASET (Gắn cờ DEMO rõ ràng theo B2)
// ==========================================
export const DEMO_PROFILE: FinanceProfile = {
  birthYear: 1994,
  maritalStatus: 'married',
  dependentsCount: 1, // 1 người phụ thuộc (con)
  employmentType: 'salaried',
  riskTolerance: 'growth',
  consentStorage: true,
  consentAI: true,
  consentOpenBanking: false,
  updatedAt: '06/10/2026',
};

export function createSnapshotFromEntries(params: {
  period: string; // YYYY-MM
  profile: FinanceProfile;
  grossSalary: number;
  bonus?: number;
  otherIncome?: number;
  insuranceSalaryBase?: number;
  expenses: ExpenseItem[];
  assets: AssetItem[];
  debts: DebtItem[];
  goals: FinancialGoal[];
  isDemo?: boolean;
  prevSnapshotNetWorth?: number;
}): MonthlySnapshot {
  const {
    period,
    profile,
    grossSalary,
    bonus = 0,
    otherIncome = 0,
    insuranceSalaryBase,
    expenses,
    assets,
    debts,
    goals,
    isDemo = false,
    prevSnapshotNetWorth,
  } = params;

  // 1. Chạy Tax-VN engine
  const taxResult = calculateTaxVn(
    grossSalary,
    bonus,
    otherIncome,
    insuranceSalaryBase,
    profile.dependentsCount
  );

  const incomeEntry = {
    period,
    grossSalary,
    bonus,
    otherIncome,
    insuranceSalaryBase: taxResult.insuranceSalaryBase,
    dependentsCount: profile.dependentsCount,
    mandatoryInsurance: taxResult.mandatoryInsurance,
    personalIncomeTax: taxResult.personalIncomeTax,
    netTakeHome: taxResult.netTakeHome,
  };

  // 2. Chạy Networth engine
  const networthRes = calculateNetworth(assets, debts, prevSnapshotNetWorth);

  // 3. Chạy Cashflow engine
  const cashflowRes = calculateCashflow(
    taxResult.netTakeHome,
    expenses,
    networthRes.liquidAssets,
    period
  );

  // 4. Đánh giá quỹ khẩn cấp
  const essentialMonthlyExpenses = cashflowRes.fixedExpenses + cashflowRes.variableExpenses * 0.5;
  const emergencyFundMonths = essentialMonthlyExpenses > 0
    ? Number((networthRes.liquidAssets / essentialMonthlyExpenses).toFixed(1))
    : 0;

  const totalMinDebtPayment = debts.reduce((sum, d) => sum + d.minMonthlyPayment, 0);
  const debtToIncomeRatio = taxResult.netTakeHome > 0
    ? Number(((totalMinDebtPayment / taxResult.netTakeHome) * 100).toFixed(1))
    : 0;

  const hasHighInterestDebt = debts.some((d) => d.balance > 0 && d.interestRate >= 12);
  const investedAssetsRatio = networthRes.totalAssets > 0
    ? Number(((networthRes.investedAssets / networthRes.totalAssets) * 100).toFixed(1))
    : 0;

  // 5. Chạy Health-Score engine
  const healthRes = calculateHealthScore({
    netIncome: taxResult.netTakeHome,
    savingsRate: cashflowRes.savingsRate,
    fixedCostRatio: cashflowRes.fixedCostRatio,
    emergencyFundMonths,
    totalDebt: networthRes.totalDebt,
    debtToIncomeRatio,
    hasHighInterestDebt,
    netWorth: networthRes.netWorth,
    investedAssetsRatio,
    hasRecentCheckin: true,
    consecutiveCheckinsCount: 3,
  });

  const metrics: CalculatedMetrics = {
    totalGrossIncome: taxResult.totalGrossIncome,
    totalNetIncome: taxResult.netTakeHome,
    totalExpenses: cashflowRes.totalExpenses,
    fixedExpenses: cashflowRes.fixedExpenses,
    variableExpenses: cashflowRes.variableExpenses,
    monthlySavings: cashflowRes.monthlySavings,
    savingsRate: cashflowRes.savingsRate,
    fixedCostRatio: cashflowRes.fixedCostRatio,
    totalAssets: networthRes.totalAssets,
    liquidAssets: networthRes.liquidAssets,
    investedAssets: networthRes.investedAssets,
    totalDebt: networthRes.totalDebt,
    netWorth: networthRes.netWorth,
    emergencyFundMonths,
    debtToIncomeRatio,
    healthScore: {
      total: healthRes.total,
      cashflowScore: healthRes.cashflowScore,
      emergencyScore: healthRes.emergencyScore,
      debtScore: healthRes.debtScore,
      networthScore: healthRes.networthScore,
      disciplineScore: healthRes.disciplineScore,
      ratingText: healthRes.ratingBand,
    },
  };

  return {
    period,
    profile,
    income: incomeEntry,
    expenses,
    assets,
    debts,
    goals,
    metrics,
    engineVersion: 'orca-engine-v2026.1',
    timestamp: new Date().toISOString(),
    isDemo,
  };
}

export function generateDemoSnapshots(): MonthlySnapshot[] {
  // Demo Kỳ 2026-08
  const snap08 = createSnapshotFromEntries({
    period: '2026-08',
    profile: DEMO_PROFILE,
    grossSalary: 38000000,
    bonus: 0,
    otherIncome: 3000000,
    insuranceSalaryBase: 38000000,
    expenses: [
      { id: 'e1', category: 'housing', name: 'Thuê căn hộ & phí quản lý', amount: 9500000, isFixed: true },
      { id: 'e2', category: 'utilities', name: 'Điện, nước & internet', amount: 2200000, isFixed: true },
      { id: 'e3', category: 'food', name: 'Ăn uống gia đình & siêu thị', amount: 7500000, isFixed: false },
      { id: 'e4', category: 'transport', name: 'Xăng xe & bảo dưỡng', amount: 1800000, isFixed: false },
      { id: 'e5', category: 'education', name: 'Học phí mầm non bán công', amount: 3500000, isFixed: true },
      { id: 'e6', category: 'healthcare', name: 'Y tế & thực phẩm chức năng', amount: 1000000, isFixed: false },
      { id: 'e7', category: 'entertainment', name: 'Cuối tuần & cafe', amount: 2000000, isFixed: false },
      { id: 'e8', category: 'family_support', name: 'Biếu phụ mẫu 2 bên', amount: 2000000, isFixed: true },
    ],
    assets: [
      { id: 'a1', category: 'cash', name: 'Tài khoản thanh toán Techcombank', balance: 25000000, updatedAt: '31/08/2026' },
      { id: 'a2', category: 'savings', name: 'Tiết kiệm online VCB 6 tháng', balance: 60000000, updatedAt: '31/08/2026', interestRate: 4.5 },
      { id: 'a3', category: 'gold', name: '0.5 cây vàng nhẫn SJC 999.9', balance: 41000000, updatedAt: '31/08/2026' },
      { id: 'a4', category: 'stocks', name: 'Cổ phiếu FPT, HPG (SSI)', balance: 95000000, updatedAt: '31/08/2026' },
      { id: 'a5', category: 'funds', name: 'Chứng chỉ quỹ DCDS & VFMVN30', balance: 65000000, updatedAt: '31/08/2026' },
    ],
    debts: [
      { id: 'd1', category: 'credit_card', name: 'Thẻ tín dụng VIB CashBack', balance: 14000000, interestRate: 24.0, minMonthlyPayment: 2000000, remainingMonths: 7 },
      { id: 'd2', category: 'consumer_loan', name: 'Vay mua laptop trả góp FECredit', balance: 8000000, interestRate: 15.0, minMonthlyPayment: 1500000, remainingMonths: 6 },
    ],
    goals: [
      { id: 'g1', name: 'Quỹ dự phòng an toàn 6 tháng', targetAmount: 120000000, accumulatedAmount: 85000000, deadline: '2027-04', priority: 'high', status: 'on_track' },
      { id: 'g2', name: 'Tích lũy mua nhà sơ cấp', targetAmount: 800000000, accumulatedAmount: 160000000, deadline: '2029-12', priority: 'high', status: 'lagging' },
      { id: 'g3', name: 'Bảo hiểm nhân thọ gia đình', targetAmount: 30000000, accumulatedAmount: 22000000, deadline: '2026-12', priority: 'medium', status: 'on_track' },
    ],
    isDemo: true,
  });

  // Demo Kỳ 2026-09
  const snap09 = createSnapshotFromEntries({
    period: '2026-09',
    profile: DEMO_PROFILE,
    grossSalary: 38000000,
    bonus: 5000000, // Thưởng dự án
    otherIncome: 3000000,
    insuranceSalaryBase: 38000000,
    expenses: [
      { id: 'e1', category: 'housing', name: 'Thuê căn hộ & phí quản lý', amount: 9500000, isFixed: true },
      { id: 'e2', category: 'utilities', name: 'Điện, nước & internet', amount: 2100000, isFixed: true },
      { id: 'e3', category: 'food', name: 'Ăn uống gia đình & siêu thị', amount: 7200000, isFixed: false },
      { id: 'e4', category: 'transport', name: 'Xăng xe & bảo dưỡng', amount: 1600000, isFixed: false },
      { id: 'e5', category: 'education', name: 'Học phí mầm non bán công', amount: 3500000, isFixed: true },
      { id: 'e6', category: 'healthcare', name: 'Y tế & thực phẩm chức năng', amount: 800000, isFixed: false },
      { id: 'e7', category: 'entertainment', name: 'Cuối tuần & cafe', amount: 1800000, isFixed: false },
      { id: 'e8', category: 'family_support', name: 'Biếu phụ mẫu 2 bên', amount: 2000000, isFixed: true },
    ],
    assets: [
      { id: 'a1', category: 'cash', name: 'Tài khoản thanh toán Techcombank', balance: 32000000, updatedAt: '30/09/2026' },
      { id: 'a2', category: 'savings', name: 'Tiết kiệm online VCB 6 tháng', balance: 75000000, updatedAt: '30/09/2026', interestRate: 4.5 },
      { id: 'a3', category: 'gold', name: '0.5 cây vàng nhẫn SJC 999.9', balance: 42500000, updatedAt: '30/09/2026' },
      { id: 'a4', category: 'stocks', name: 'Cổ phiếu FPT, HPG (SSI)', balance: 102000000, updatedAt: '30/09/2026' },
      { id: 'a5', category: 'funds', name: 'Chứng chỉ quỹ DCDS & VFMVN30', balance: 72000000, updatedAt: '30/09/2026' },
    ],
    debts: [
      { id: 'd1', category: 'credit_card', name: 'Thẻ tín dụng VIB CashBack', balance: 9000000, interestRate: 24.0, minMonthlyPayment: 2000000, remainingMonths: 5 },
      { id: 'd2', category: 'consumer_loan', name: 'Vay mua laptop trả góp FECredit', balance: 6500000, interestRate: 15.0, minMonthlyPayment: 1500000, remainingMonths: 5 },
    ],
    goals: [
      { id: 'g1', name: 'Quỹ dự phòng an toàn 6 tháng', targetAmount: 120000000, accumulatedAmount: 107000000, deadline: '2027-04', priority: 'high', status: 'on_track' },
      { id: 'g2', name: 'Tích lũy mua nhà sơ cấp', targetAmount: 800000000, accumulatedAmount: 174000000, deadline: '2029-12', priority: 'high', status: 'lagging' },
      { id: 'g3', name: 'Bảo hiểm nhân thọ gia đình', targetAmount: 30000000, accumulatedAmount: 25000000, deadline: '2026-12', priority: 'medium', status: 'on_track' },
    ],
    isDemo: true,
    prevSnapshotNetWorth: snap08.metrics.netWorth,
  });

  // Demo Kỳ 2026-10 (Kỳ hiện tại)
  const snap10 = createSnapshotFromEntries({
    period: '2026-10',
    profile: DEMO_PROFILE,
    grossSalary: 40000000, // Tăng lương nhẹ
    bonus: 2000000,
    otherIncome: 3000000,
    insuranceSalaryBase: 40000000,
    expenses: [
      { id: 'e1', category: 'housing', name: 'Thuê căn hộ & phí quản lý', amount: 9500000, isFixed: true },
      { id: 'e2', category: 'utilities', name: 'Điện, nước & internet', amount: 2050000, isFixed: true },
      { id: 'e3', category: 'food', name: 'Ăn uống gia đình & siêu thị', amount: 7600000, isFixed: false },
      { id: 'e4', category: 'transport', name: 'Xăng xe & Grab', amount: 1500000, isFixed: false },
      { id: 'e5', category: 'education', name: 'Học phí mầm non bán công', amount: 3500000, isFixed: true },
      { id: 'e6', category: 'healthcare', name: 'Y tế & thực phẩm chức năng', amount: 900000, isFixed: false },
      { id: 'e7', category: 'entertainment', name: 'Cuối tuần & cafe', amount: 2100000, isFixed: false },
      { id: 'e8', category: 'family_support', name: 'Biếu phụ mẫu 2 bên', amount: 2000000, isFixed: true },
      { id: 'e9', category: 'shopping', name: 'Mua sắm gia dụng', amount: 1200000, isFixed: false },
    ],
    assets: [
      { id: 'a1', category: 'cash', name: 'Tài khoản thanh toán Techcombank', balance: 38000000, updatedAt: '05/10/2026' },
      { id: 'a2', category: 'savings', name: 'Tiết kiệm online VCB 6 tháng', balance: 90000000, updatedAt: '05/10/2026', interestRate: 4.5 },
      { id: 'a3', category: 'gold', name: '0.5 cây vàng nhẫn SJC 999.9', balance: 43250000, updatedAt: '05/10/2026' },
      { id: 'a4', category: 'stocks', name: 'Cổ phiếu FPT, HPG (SSI)', balance: 110000000, updatedAt: '05/10/2026' },
      { id: 'a5', category: 'funds', name: 'Chứng chỉ quỹ DCDS & VFMVN30', balance: 80000000, updatedAt: '05/10/2026' },
    ],
    debts: [
      { id: 'd1', category: 'credit_card', name: 'Thẻ tín dụng VIB CashBack', balance: 4500000, interestRate: 24.0, minMonthlyPayment: 2000000, remainingMonths: 3 },
      { id: 'd2', category: 'consumer_loan', name: 'Vay mua laptop trả góp FECredit', balance: 5000000, interestRate: 15.0, minMonthlyPayment: 1500000, remainingMonths: 4 },
    ],
    goals: [
      { id: 'g1', name: 'Quỹ dự phòng an toàn 6 tháng', targetAmount: 120000000, accumulatedAmount: 120000000, deadline: '2027-04', priority: 'high', status: 'completed' },
      { id: 'g2', name: 'Tích lũy mua nhà sơ cấp', targetAmount: 800000000, accumulatedAmount: 190000000, deadline: '2029-12', priority: 'high', status: 'lagging' },
      { id: 'g3', name: 'Bảo hiểm nhân thọ gia đình', targetAmount: 30000000, accumulatedAmount: 28000000, deadline: '2026-12', priority: 'medium', status: 'on_track' },
    ],
    isDemo: true,
    prevSnapshotNetWorth: snap09.metrics.netWorth,
  });

  return [snap08, snap09, snap10];
}

// ==========================================
// STORE FUNCTIONS
// ==========================================

export function loadProfileFromStorage(): FinanceProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PROFILE);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // fallback
  }
  return DEMO_PROFILE; // Default to realistic demo on first launch, easily clearable
}

export function saveProfileToStorage(profile: FinanceProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY_PROFILE, JSON.stringify(profile));
  } catch {
    // ignore
  }
}

export function loadSnapshotsFromStorage(): MonthlySnapshot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SNAPSHOTS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // fallback
  }
  return generateDemoSnapshots();
}

export function saveSnapshotsToStorage(snapshots: MonthlySnapshot[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_SNAPSHOTS, JSON.stringify(snapshots));
  } catch {
    // ignore
  }
}

export function loadAssumptionsFromStorage(): AssumptionSet {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ASSUMPTIONS);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // fallback
  }
  return DEFAULT_ASSUMPTIONS;
}

export function saveAssumptionsToStorage(assumptions: AssumptionSet): void {
  try {
    localStorage.setItem(STORAGE_KEY_ASSUMPTIONS, JSON.stringify(assumptions));
  } catch {
    // ignore
  }
}

/**
 * Xóa toàn bộ dữ liệu người dùng một chạm (One-click wipe B7)
 */
export function wipeAllUserData(): void {
  localStorage.removeItem(STORAGE_KEY_PROFILE);
  localStorage.removeItem(STORAGE_KEY_SNAPSHOTS);
  localStorage.removeItem(STORAGE_KEY_ASSUMPTIONS);
}

/**
 * Xuất toàn bộ dữ liệu dưới dạng JSON (B7)
 */
export function exportDataAsJson(profile: FinanceProfile, snapshots: MonthlySnapshot[]): string {
  const exportPayload = {
    brand: 'Orca Financial',
    system: 'Orca Personal Finance',
    exportedAt: new Date().toISOString(),
    pdpdCompliance: 'Nghị định 13/2023/NĐ-CP & Luật Bảo vệ dữ liệu cá nhân 2025',
    profile,
    snapshots,
  };
  return JSON.stringify(exportPayload, null, 2);
}

/**
 * Xuất dữ liệu lịch sử dòng tiền & tài sản ròng dưới dạng CSV (B7)
 */
export function exportDataAsCsv(snapshots: MonthlySnapshot[]): string {
  const headers = [
    'Ky (Period)',
    'Thu nhap Gross (VND)',
    'Bao hiem bat buoc (VND)',
    'Thue TNCN (VND)',
    'Thu nhap Thuc nhan (VND)',
    'Tong Chi tieu (VND)',
    'Chi co dinh (VND)',
    'Tiet kiem (VND)',
    'Ty le Tiet kiem (%)',
    'Tong Tai san (VND)',
    'Tong No (VND)',
    'Tai san rong (VND)',
    'Diem suc khoe (0-100)',
    'Quy khan cap (Thang)',
  ];

  const rows = snapshots.map((s) => [
    s.period,
    s.metrics.totalGrossIncome,
    s.income.mandatoryInsurance.total,
    s.income.personalIncomeTax,
    s.metrics.totalNetIncome,
    s.metrics.totalExpenses,
    s.metrics.fixedExpenses,
    s.metrics.monthlySavings,
    s.metrics.savingsRate,
    s.metrics.totalAssets,
    s.metrics.totalDebt,
    s.metrics.netWorth,
    s.metrics.healthScore.total,
    s.metrics.emergencyFundMonths,
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}
