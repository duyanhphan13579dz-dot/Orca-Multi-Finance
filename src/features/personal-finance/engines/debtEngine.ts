/**
 * Engine Debt: So sánh chiến lược trả nợ Avalanche (lãi suất cao trước) vs Snowball (dư nợ nhỏ trước).
 * Tính chi tiết tổng tiền lãi, thời gian hết nợ và chênh lệch giữa 2 phương án.
 */

import { DebtItem } from '../types/finance.ts';

export interface DebtStrategyMonthDetail {
  month: number;
  totalRemainingBalance: number;
  totalInterestPaidThisMonth: number;
  totalPrincipalPaidThisMonth: number;
}

export interface DebtStrategyResult {
  strategy: 'avalanche' | 'snowball';
  title: string;
  description: string;
  monthsToDebtFree: number;
  debtFreeDateText: string;
  totalInterestPaid: number;
  totalPaid: number;
  monthlySchedule: DebtStrategyMonthDetail[];
}

export interface DebtComparisonResult {
  hasDebt: boolean;
  totalInitialDebt: number;
  totalMinMonthlyPayment: number;
  extraPaymentAmount: number;
  avalanche: DebtStrategyResult;
  snowball: DebtStrategyResult;
  interestDifference: number; // Avalanche tiết kiệm được bao nhiêu so với Snowball
  monthsDifference: number; // Avalanche nhanh hơn bao nhiêu tháng (hoặc ngược lại)
  recommendation: {
    recommendedStrategy: 'avalanche' | 'snowball';
    summaryReason: string;
  };
}

interface WorkingDebt {
  id: string;
  name: string;
  balance: number;
  interestRate: number; // annual %
  minPayment: number;
}

function simulatePayoff(
  debts: DebtItem[],
  extraMonthlyPayment: number,
  strategy: 'avalanche' | 'snowball'
): DebtStrategyResult {
  const currentYear = 2026;
  const currentMonth = 10;

  if (debts.length === 0 || debts.every((d) => d.balance <= 0)) {
    return {
      strategy,
      title: strategy === 'avalanche' ? 'Chiến lược Avalanche (Tối ưu lãi suất)' : 'Chiến lược Snowball (Tâm lý đà tăng)',
      description: 'Không có dư nợ cần thanh toán.',
      monthsToDebtFree: 0,
      debtFreeDateText: 'Hiện không có nợ',
      totalInterestPaid: 0,
      totalPaid: 0,
      monthlySchedule: [],
    };
  }

  // Clone working debts
  const items: WorkingDebt[] = debts
    .filter((d) => d.balance > 0)
    .map((d) => ({
      id: d.id,
      name: d.name,
      balance: d.balance,
      interestRate: d.interestRate / 100, // decimal annual
      minPayment: Math.max(0, d.minMonthlyPayment),
    }));

  const initialDebtTotal = items.reduce((acc, d) => acc + d.balance, 0);
  const totalMinPayment = items.reduce((acc, d) => acc + d.minPayment, 0);
  const totalMonthlyBudget = totalMinPayment + Math.max(0, extraMonthlyPayment);

  let monthCount = 0;
  let accumulatedInterest = 0;
  let accumulatedPaid = 0;
  const monthlySchedule: DebtStrategyMonthDetail[] = [];
  const MAX_MONTHS = 360; // 30 years ceiling to prevent infinite loops

  while (items.some((d) => d.balance > 0.01) && monthCount < MAX_MONTHS) {
    monthCount++;
    let monthInterest = 0;
    let monthPrincipal = 0;

    // 1. Tính lãi tháng cho tất cả các khoản nợ
    for (const item of items) {
      if (item.balance > 0) {
        const monthlyRate = item.interestRate / 12;
        const interest = item.balance * monthlyRate;
        item.balance += interest;
        monthInterest += interest;
      }
    }

    let budgetLeft = totalMonthlyBudget;

    // 2. Trả mức tối thiểu cho các khoản còn dư nợ
    for (const item of items) {
      if (item.balance > 0) {
        const payment = Math.min(item.balance, item.minPayment);
        item.balance -= payment;
        budgetLeft -= payment;
        monthPrincipal += payment;
      }
    }

    // 3. Sắp xếp thứ tự để dồn tiền trả thêm (extra budget + freed up minimum payments)
    if (strategy === 'avalanche') {
      // Ưu tiên lãi suất cao nhất
      items.sort((a, b) => b.interestRate - a.interestRate);
    } else {
      // Ưu tiên số dư nhỏ nhất (Snowball)
      items.sort((a, b) => {
        if (a.balance <= 0) return 1;
        if (b.balance <= 0) return -1;
        return a.balance - b.balance;
      });
    }

    // 4. Dồn số tiền còn lại vào khoản nợ ưu tiên đầu tiên còn dư nợ
    for (const item of items) {
      if (budgetLeft <= 0) break;
      if (item.balance > 0) {
        const extraPay = Math.min(item.balance, budgetLeft);
        item.balance -= extraPay;
        budgetLeft -= extraPay;
        monthPrincipal += extraPay;
      }
    }

    accumulatedInterest += monthInterest;
    accumulatedPaid += (monthInterest + monthPrincipal);

    const remainingBal = items.reduce((acc, d) => acc + Math.max(0, d.balance), 0);

    monthlySchedule.push({
      month: monthCount,
      totalRemainingBalance: Math.round(remainingBal),
      totalInterestPaidThisMonth: Math.round(monthInterest),
      totalPrincipalPaidThisMonth: Math.round(monthPrincipal),
    });

    if (remainingBal <= 1) break;
  }

  // Tính thời điểm trả hết nợ
  const targetMonthIndex = (currentMonth - 1 + monthCount) % 12 + 1;
  const targetYear = currentYear + Math.floor((currentMonth - 1 + monthCount) / 12);
  const debtFreeDateText = `Tháng ${targetMonthIndex}/${targetYear} (${monthCount} tháng)`;

  return {
    strategy,
    title: strategy === 'avalanche' ? 'Chiến lược Avalanche (Tối ưu lãi suất)' : 'Chiến lược Snowball (Động lực trả từng khoản)',
    description: strategy === 'avalanche'
      ? 'Dồn toàn bộ tiền trả thêm vào khoản có lãi suất cao nhất để giảm thiểu tối đa tiền lãi phải trả cho ngân hàng.'
      : 'Thanh toán dứt điểm khoản nợ nhỏ nhất trước để tạo động lực tâm lý giải phóng từng khoản nợ.',
    monthsToDebtFree: monthCount,
    debtFreeDateText,
    totalInterestPaid: Math.round(accumulatedInterest),
    totalPaid: Math.round(initialDebtTotal + accumulatedInterest),
    monthlySchedule,
  };
}

export function compareDebtStrategies(
  debts: DebtItem[],
  extraMonthlyPayment: number = 0
): DebtComparisonResult {
  const activeDebts = debts.filter((d) => d.balance > 0);
  const totalInitialDebt = activeDebts.reduce((acc, d) => acc + d.balance, 0);
  const totalMinMonthlyPayment = activeDebts.reduce((acc, d) => acc + d.minMonthlyPayment, 0);

  if (activeDebts.length === 0) {
    const emptyResult: DebtStrategyResult = {
      strategy: 'avalanche',
      title: 'Không có nợ',
      description: 'Hiện không có dư nợ nào.',
      monthsToDebtFree: 0,
      debtFreeDateText: '0 tháng',
      totalInterestPaid: 0,
      totalPaid: 0,
      monthlySchedule: [],
    };
    return {
      hasDebt: false,
      totalInitialDebt: 0,
      totalMinMonthlyPayment: 0,
      extraPaymentAmount: extraMonthlyPayment,
      avalanche: emptyResult,
      snowball: { ...emptyResult, strategy: 'snowball' },
      interestDifference: 0,
      monthsDifference: 0,
      recommendation: {
        recommendedStrategy: 'avalanche',
        summaryReason: 'Tình trạng tài chính lành mạnh không có nợ vay.',
      },
    };
  }

  const avalanche = simulatePayoff(activeDebts, extraMonthlyPayment, 'avalanche');
  const snowball = simulatePayoff(activeDebts, extraMonthlyPayment, 'snowball');

  const interestDifference = snowball.totalInterestPaid - avalanche.totalInterestPaid;
  const monthsDifference = snowball.monthsToDebtFree - avalanche.monthsToDebtFree;

  const summaryReason = interestDifference > 500000
    ? `Chiến lược Avalanche giúp tiết kiệm ${interestDifference.toLocaleString('vi-VN')} ₫ tiền lãi và về đích ${Math.abs(monthsDifference)} tháng sớm hơn hoặc tương đương.`
    : `Hai phương án có chi phí lãi xấp xỉ nhau (${interestDifference.toLocaleString('vi-VN')} ₫). Có thể chọn Snowball nếu muốn cảm giác hoàn thành sớm từng khoản.`;

  return {
    hasDebt: true,
    totalInitialDebt,
    totalMinMonthlyPayment,
    extraPaymentAmount: extraMonthlyPayment,
    avalanche,
    snowball,
    interestDifference,
    monthsDifference,
    recommendation: {
      recommendedStrategy: interestDifference > 1000000 ? 'avalanche' : 'snowball',
      summaryReason,
    },
  };
}
