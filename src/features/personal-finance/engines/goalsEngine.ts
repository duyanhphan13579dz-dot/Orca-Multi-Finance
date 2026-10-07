/**
 * Engine Goals: Quản lý mục tiêu tài chính, tiến độ thực tế so với lộ trình,
 * tính số tiền cần tích lũy mỗi tháng và gắn cờ chậm (lagging) khi tiến độ thấp hơn kế hoạch > 10%.
 */

import { FinancialGoal } from '../types/finance.ts';

export interface GoalEvaluationItem extends FinancialGoal {
  monthsRemaining: number;
  remainingAmount: number;
  expectedPaceAmount: number; // Số tiền lẽ ra phải tích lũy đến hiện tại
  paceDifference: number;
  lagPercent: number; // % chậm trễ
  isLagging: boolean; // Flag chậm > 10%
  requiredMonthlySavings: number; // Số tiền cần góp mỗi tháng để kịp hạn
  feasibility: 'achievable' | 'challenging' | 'unrealistic' | 'completed';
  feasibilityNotes: string;
}

export interface GoalsSummaryResult {
  totalTargetAmount: number;
  totalAccumulatedAmount: number;
  totalRemainingAmount: number;
  overallProgressPercent: number;
  totalRequiredMonthlySavings: number;
  laggingGoalsCount: number;
  goals: GoalEvaluationItem[];
}

export function evaluateGoals(
  goals: FinancialGoal[],
  currentPeriod: string = '2026-10',
  currentMonthlySavings: number = 0
): GoalsSummaryResult {
  const [curYearStr, curMonthStr] = currentPeriod.split('-');
  const curYear = parseInt(curYearStr || '2026', 10);
  const curMonth = parseInt(curMonthStr || '10', 10);
  const curTotalMonths = curYear * 12 + curMonth;

  let totalTarget = 0;
  let totalAccumulated = 0;
  let totalRemaining = 0;
  let totalRequiredMonthly = 0;
  let laggingCount = 0;

  const evaluatedGoals: GoalEvaluationItem[] = goals.map((goal) => {
    const target = Math.max(0, goal.targetAmount);
    const accum = Math.max(0, goal.accumulatedAmount);
    const remaining = Math.max(0, target - accum);

    totalTarget += target;
    totalAccumulated += accum;
    totalRemaining += remaining;

    // Parse deadline
    const [dlYearStr, dlMonthStr] = goal.deadline.split('-');
    const dlYear = parseInt(dlYearStr || '2027', 10);
    const dlMonth = parseInt(dlMonthStr || '12', 10);
    const dlTotalMonths = dlYear * 12 + dlMonth;

    const monthsRemaining = Math.max(1, dlTotalMonths - curTotalMonths);

    // Tính số tiền cần góp mỗi tháng
    const requiredMonthly = remaining > 0 ? Math.ceil(remaining / monthsRemaining) : 0;
    totalRequiredMonthly += requiredMonthly;

    // Tiến độ so với thời gian (giả định mục tiêu tạo cách đây ít nhất 6-12 tháng)
    const completionPct = target > 0 ? (accum / target) * 100 : 100;
    
    // Đánh giá trễ hạn: nếu tỷ lệ hoàn thành thấp hơn tỷ lệ thời gian đã trôi qua trên 10%
    // Giả định tổng chu kỳ mục tiêu chuẩn tối thiểu là (monthsRemaining + 6)
    const assumedTotalDuration = Math.max(12, monthsRemaining + 6);
    const timeElapsedMonths = Math.max(0, assumedTotalDuration - monthsRemaining);
    const expectedTimeProgressPct = (timeElapsedMonths / assumedTotalDuration) * 100;

    const paceDifference = expectedTimeProgressPct - completionPct;
    const isLagging = remaining > 0 && paceDifference > 10;
    const lagPercent = isLagging ? Number(paceDifference.toFixed(1)) : 0;

    if (isLagging) {
      laggingCount++;
    }

    let feasibility: GoalEvaluationItem['feasibility'] = 'achievable';
    let feasibilityNotes = 'Khả thi với mức tích lũy hiện tại.';

    if (remaining === 0) {
      feasibility = 'completed';
      feasibilityNotes = 'Đã hoàn thành mục tiêu 100%.';
    } else if (currentMonthlySavings > 0 && requiredMonthly > currentMonthlySavings * 1.5) {
      feasibility = 'unrealistic';
      feasibilityNotes = `Số tiền cần góp (${requiredMonthly.toLocaleString('vi-VN')} ₫/tháng) vượt quá năng lực tiết kiệm tháng này.`;
    } else if (currentMonthlySavings > 0 && requiredMonthly > currentMonthlySavings) {
      feasibility = 'challenging';
      feasibilityNotes = `Cần phân bổ thêm ${ (requiredMonthly - currentMonthlySavings).toLocaleString('vi-VN') } ₫/tháng từ các khoản khác.`;
    }

    const updatedStatus = remaining === 0
      ? 'completed'
      : isLagging
      ? 'lagging'
      : goal.status === 'paused'
      ? 'paused'
      : 'on_track';

    return {
      ...goal,
      status: updatedStatus,
      monthsRemaining,
      remainingAmount: remaining,
      expectedPaceAmount: Math.round((target * expectedTimeProgressPct) / 100),
      paceDifference: Math.round(paceDifference),
      lagPercent,
      isLagging,
      requiredMonthlySavings: requiredMonthly,
      feasibility,
      feasibilityNotes,
    };
  });

  const overallProgressPercent = totalTarget > 0
    ? Number(((totalAccumulated / totalTarget) * 100).toFixed(1))
    : 0;

  return {
    totalTargetAmount: totalTarget,
    totalAccumulatedAmount: totalAccumulated,
    totalRemainingAmount: totalRemaining,
    overallProgressPercent,
    totalRequiredMonthlySavings: totalRequiredMonthly,
    laggingGoalsCount: laggingCount,
    goals: evaluatedGoals,
  };
}
