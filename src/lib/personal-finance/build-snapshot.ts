import type {
  FinanceProfile,
  ExpenseItem,
  AssetItem,
  DebtItem,
  FinancialGoal,
  MonthlySnapshot,
  CalculatedMetrics,
  IncomeEntry,
} from "./types";
import { calculateTaxVn } from "./engines/taxVnEngine";
import { calculateCashflow } from "./engines/cashflowEngine";
import { calculateNetworth } from "./engines/networthEngine";
import { calculateHealthScore } from "./engines/healthScoreEngine";

export type CheckinInput = {
  period: string;
  profile: FinanceProfile;
  grossSalary: number;
  bonus: number;
  otherIncome: number;
  insuranceSalaryBase?: number;
  dependentsCount: number;
  expenses: ExpenseItem[];
  assets: AssetItem[];
  debts: DebtItem[];
  goals?: FinancialGoal[];
  previousSnapshots?: MonthlySnapshot[];
};

export function buildMonthlySnapshot(input: CheckinInput): MonthlySnapshot {
  const tax = calculateTaxVn({
    grossSalary: input.grossSalary,
    bonus: input.bonus,
    otherIncome: input.otherIncome,
    insuranceSalaryBase: input.insuranceSalaryBase ?? input.grossSalary,
    dependentsCount: input.dependentsCount,
  });

  const income: IncomeEntry = {
    period: input.period,
    grossSalary: input.grossSalary,
    bonus: input.bonus,
    otherIncome: input.otherIncome,
    insuranceSalaryBase: input.insuranceSalaryBase ?? input.grossSalary,
    dependentsCount: input.dependentsCount,
    mandatoryInsurance: {
      bhxh: Math.round(tax.mandatoryInsuranceTotal * (8 / 10.5)),
      bhyt: Math.round(tax.mandatoryInsuranceTotal * (1.5 / 10.5)),
      bhtn: Math.round(tax.mandatoryInsuranceTotal * (1 / 10.5)),
      total: tax.mandatoryInsuranceTotal,
      isCapped: (input.insuranceSalaryBase ?? input.grossSalary) >= 46_800_000,
    },
    personalIncomeTax: tax.personalIncomeTax,
    netTakeHome: tax.netTakeHome,
  };

  const nw = calculateNetworth(input.assets, input.debts);
  const cf = calculateCashflow(tax.netTakeHome, input.expenses, nw.liquidAssets);

  const minDebtPay = input.debts.reduce((s, d) => s + Math.max(0, d.minMonthlyPayment), 0);
  const dti = tax.netTakeHome > 0 ? (minDebtPay / tax.netTakeHome) * 100 : 0;
  const hasHighInterest = input.debts.some((d) => d.interestRate >= 18);
  const investedRatio = nw.totalAssets > 0 ? (nw.investedAssets / nw.totalAssets) * 100 : 0;

  const prev = input.previousSnapshots ?? [];
  const consecutive = countConsecutiveCheckins(prev, input.period);

  const hs = calculateHealthScore({
    savingsRate: cf.savingsRate,
    fixedCostRatio: cf.fixedCostRatio,
    emergencyFundMonths: cf.emergencyFundMonths,
    totalDebt: nw.totalDebt,
    debtToIncomeRatio: dti,
    hasHighInterestDebt: hasHighInterest,
    netWorth: nw.netWorth,
    investedAssetsRatio: investedRatio,
    hasRecentCheckin: true,
    consecutiveCheckinsCount: consecutive + 1,
  });

  const metrics: CalculatedMetrics = {
    totalGrossIncome: input.grossSalary + input.bonus + input.otherIncome,
    totalNetIncome: tax.netTakeHome,
    totalExpenses: cf.totalExpenses,
    fixedExpenses: cf.fixedExpenses,
    variableExpenses: cf.variableExpenses,
    monthlySavings: cf.monthlySavings,
    savingsRate: cf.savingsRate,
    fixedCostRatio: cf.fixedCostRatio,
    totalAssets: nw.totalAssets,
    liquidAssets: nw.liquidAssets,
    investedAssets: nw.investedAssets,
    totalDebt: nw.totalDebt,
    netWorth: nw.netWorth,
    emergencyFundMonths: cf.emergencyFundMonths,
    debtToIncomeRatio: dti,
    healthScore: {
      total: hs.total,
      cashflowScore: hs.cashflowScore,
      emergencyScore: hs.emergencyScore,
      debtScore: hs.debtScore,
      networthScore: hs.networthScore,
      disciplineScore: hs.disciplineScore,
      ratingText: hs.ratingText,
    },
  };

  return {
    period: input.period,
    profile: input.profile,
    income,
    expenses: input.expenses,
    assets: input.assets,
    debts: input.debts,
    goals: input.goals ?? [],
    metrics,
    engineVersion: "orca-pf-engine-v2026.2",
    timestamp: new Date().toISOString(),
  };
}

function countConsecutiveCheckins(snapshots: MonthlySnapshot[], currentPeriod: string): number {
  const set = new Set(snapshots.map((s) => s.period));
  let count = 0;
  const [y, m] = currentPeriod.split("-").map(Number);
  let cy = y;
  let cm = m - 1;
  for (let i = 0; i < 24; i++) {
    if (cm < 1) {
      cm = 12;
      cy -= 1;
    }
    const key = `${cy}-${String(cm).padStart(2, "0")}`;
    if (!set.has(key)) break;
    count += 1;
    cm -= 1;
  }
  return count;
}

export function currentPeriodYm(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
