import type { ExpenseItem } from "../types";

export interface CashflowAnalysisResult {
  totalExpenses: number;
  fixedExpenses: number;
  variableExpenses: number;
  monthlySavings: number;
  savingsRate: number;
  fixedCostRatio: number;
  emergencyFundMonths: number;
}

export function calculateCashflow(
  netTakeHome: number,
  expenses: ExpenseItem[],
  liquidAssets: number = 0,
): CashflowAnalysisResult {
  const safeNet = Math.max(0, netTakeHome);
  let fixedExpenses = 0;
  let variableExpenses = 0;
  for (const exp of expenses) {
    const amt = Math.max(0, exp.amount);
    if (exp.isFixed) fixedExpenses += amt;
    else variableExpenses += amt;
  }
  const totalExpenses = fixedExpenses + variableExpenses;
  const monthlySavings = safeNet - totalExpenses;
  const savingsRate = safeNet > 0 ? (monthlySavings / safeNet) * 100 : 0;
  const fixedCostRatio = safeNet > 0 ? (fixedExpenses / safeNet) * 100 : 0;
  const essential = fixedExpenses > 0 ? fixedExpenses : totalExpenses * 0.7;
  const emergencyFundMonths = essential > 0 ? liquidAssets / essential : 0;
  return {
    totalExpenses,
    fixedExpenses,
    variableExpenses,
    monthlySavings,
    savingsRate,
    fixedCostRatio,
    emergencyFundMonths,
  };
}
