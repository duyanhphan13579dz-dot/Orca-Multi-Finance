/**
 * Engine Cashflow: Dòng tiền, tiết kiệm, tỷ lệ chi cố định và dự báo 12 tháng.
 */

import { ExpenseItem } from '../types/finance.ts';

export interface CashflowAnalysisResult {
  netTakeHome: number;
  totalExpenses: number;
  fixedExpenses: number;
  variableExpenses: number;
  monthlySavings: number;
  savingsRate: number; // Tỷ lệ tiết kiệm (%)
  fixedCostRatio: number; // Tỷ lệ chi phí cố định (%)
  variableCostRatio: number; // Tỷ lệ chi phí biến đổi (%)
  burnRatePerDay: number; // Chi tiêu trung bình mỗi ngày
  runwayMonths: number; // Số tháng sống sót nếu mất thu nhập dựa trên tài sản thanh khoản
  forecast12Months: Array<{
    monthIndex: number; // 1 -> 12
    monthLabel: string;
    projectedIncome: number;
    projectedExpense: number;
    projectedSavings: number;
    cumulativeSavings: number;
  }>;
}

export function calculateCashflow(
  netTakeHome: number,
  expenses: ExpenseItem[],
  liquidAssets: number = 0,
  currentPeriod: string = '2026-10'
): CashflowAnalysisResult {
  const safeNet = Math.max(0, netTakeHome);
  
  let fixedExpenses = 0;
  let variableExpenses = 0;

  for (const exp of expenses) {
    const amt = Math.max(0, exp.amount);
    if (exp.isFixed) {
      fixedExpenses += amt;
    } else {
      variableExpenses += amt;
    }
  }

  const totalExpenses = fixedExpenses + variableExpenses;
  const monthlySavings = safeNet - totalExpenses;

  const savingsRate = safeNet > 0
    ? Number(((monthlySavings / safeNet) * 100).toFixed(2))
    : 0;

  const fixedCostRatio = safeNet > 0
    ? Number(((fixedExpenses / safeNet) * 100).toFixed(2))
    : 0;

  const variableCostRatio = safeNet > 0
    ? Number(((variableExpenses / safeNet) * 100).toFixed(2))
    : 0;

  const burnRatePerDay = Math.round(totalExpenses / 30);
  const runwayMonths = totalExpenses > 0
    ? Number((liquidAssets / totalExpenses).toFixed(1))
    : 0;

  // Dự báo 12 tháng kế tiếp
  const [yearStr, monthStr] = currentPeriod.split('-');
  const baseYear = parseInt(yearStr || '2026', 10);
  const baseMonth = parseInt(monthStr || '10', 10);

  const forecast12Months: CashflowAnalysisResult['forecast12Months'] = [];
  let cumulative = 0;

  for (let i = 1; i <= 12; i++) {
    const targetMonth = ((baseMonth - 1 + i) % 12) + 1;
    const targetYear = baseYear + Math.floor((baseMonth - 1 + i) / 12);
    const monthLabel = `T${targetMonth}/${targetYear}`;

    // Dự phóng cơ bản: duy trì thu nhập và chi tiêu, thưởng Tết (tháng 1 hoặc 2 dương lịch) có thể cấu hình
    const isTetMonth = targetMonth === 1 || targetMonth === 2;
    const projectedIncome = isTetMonth ? safeNet * 1.5 : safeNet;
    const projectedExpense = isTetMonth ? totalExpenses * 1.3 : totalExpenses;
    const projectedSavings = projectedIncome - projectedExpense;
    cumulative += projectedSavings;

    forecast12Months.push({
      monthIndex: i,
      monthLabel,
      projectedIncome: Math.round(projectedIncome),
      projectedExpense: Math.round(projectedExpense),
      projectedSavings: Math.round(projectedSavings),
      cumulativeSavings: Math.round(cumulative),
    });
  }

  return {
    netTakeHome: safeNet,
    totalExpenses,
    fixedExpenses,
    variableExpenses,
    monthlySavings,
    savingsRate,
    fixedCostRatio,
    variableCostRatio,
    burnRatePerDay,
    runwayMonths,
    forecast12Months,
  };
}
