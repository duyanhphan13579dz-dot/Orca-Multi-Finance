/**
 * Engine Advice: Sinh tối đa 5 lời khuyên định lượng xếp theo thứ tự ưu tiên nghiêm ngặt (B5).
 * Thứ tự ưu tiên:
 * 1. Quỹ khẩn cấp tối thiểu (< 3 tháng)
 * 2. Nợ lãi suất cao (> 12-15%)
 * 3. Chi phí cố định quá cao (> 65% thu nhập thực nhận)
 * 4. Tỷ lệ tiết kiệm thấp (< 20%)
 * 5. Tối ưu hóa phân bổ tài sản & mục tiêu
 *
 * MỖI LỜI KHUYÊN BẮT BUỘC ĐẦY ĐỦ 6 PHẦN:
 * 1. Phát hiện (số liệu)
 * 2. Tác động
 * 3. Hành động cụ thể
 * 4. Số tiền
 * 5. Thời hạn
 * 6. Giả định và mức tin cậy
 */

import {
  CalculatedMetrics,
  FinanceProfile,
  DebtItem,
  ExpenseItem,
  FinancialGoal,
  Insight,
  SixPartAdvice,
} from '../types/finance.ts';

export function generateQuantitativeAdvice(params: {
  period: string; // YYYY-MM
  profile: FinanceProfile;
  metrics: CalculatedMetrics;
  debts: DebtItem[];
  expenses: ExpenseItem[];
  goals: FinancialGoal[];
}): Insight[] {
  const { period, metrics, debts, goals } = params;
  const insights: Insight[] = [];

  const essentialMonthlyExpenses = metrics.fixedExpenses + (metrics.variableExpenses * 0.5);
  const targetEmergencyFund = essentialMonthlyExpenses * 3; // Mức sàn 3 tháng
  const currentEmergencyFund = metrics.liquidAssets;
  const emergencyDeficit = Math.max(0, targetEmergencyFund - currentEmergencyFund);

  // -------------------------------------------------------------
  // Ưu tiên 1: Quỹ khẩn cấp tối thiểu (< 3 tháng)
  // -------------------------------------------------------------
  if (metrics.emergencyFundMonths < 3.0) {
    const monthsCurrent = metrics.emergencyFundMonths;
    const requiredAdd = emergencyDeficit;
    const monthlyAlloc = metrics.monthlySavings > 0
      ? Math.min(metrics.monthlySavings, Math.round(requiredAdd / 3))
      : Math.round(requiredAdd / 6);

    const content: SixPartAdvice = {
      finding: `Quỹ dự phòng thanh khoản hiện có ${currentEmergencyFund.toLocaleString('vi-VN')} ₫, chỉ đủ trang trải ${monthsCurrent.toFixed(1)} tháng chi tiêu thiết yếu (chuẩn an toàn tối thiểu là 3.0 đến 6.0 tháng).`,
      impact: `Nếu xảy ra rủi ro thu nhập hoặc sự cố y tế đột xuất, bạn buộc phải vay nóng hoặc bán tài sản đầu tư trong tình thế thua lỗ.`,
      action: `Mở tài khoản tiền gửi tiết kiệm trực tuyến kỳ hạn 1 tháng hoặc tài khoản tích lũy sinh lời hàng ngày, trích tự động ngay sau khi nhận lương.`,
      amount: monthlyAlloc > 0 ? monthlyAlloc : requiredAdd,
      deadline: 'Trước kỳ Monthly Check-in tháng sau',
      assumptionsAndConfidence: `Giả định chi phí thiết yếu không tăng đột biến; Mức độ tin cậy: Rất cao (98%).`,
    };

    insights.push({
      id: `insight-emergency-${period}`,
      period,
      ruleCode: 'RULE_EMERGENCY_DEFICIT',
      priorityOrder: 1,
      severity: 'critical',
      title: 'Thiếu hụt quỹ dự phòng khẩn cấp tối thiểu',
      content,
      status: 'new',
    });
  }

  // -------------------------------------------------------------
  // Ưu tiên 2: Nợ lãi suất cao (> 12%)
  // -------------------------------------------------------------
  const highInterestDebts = debts.filter((d) => d.balance > 0 && d.interestRate >= 12);
  if (highInterestDebts.length > 0) {
    // Tìm khoản nợ có lãi cao nhất
    highInterestDebts.sort((a, b) => b.interestRate - a.interestRate);
    const worstDebt = highInterestDebts[0];
    const totalHighDebt = highInterestDebts.reduce((sum, d) => sum + d.balance, 0);
    const annualInterestLoss = Math.round((worstDebt.balance * worstDebt.interestRate) / 100);

    const content: SixPartAdvice = {
      finding: `Phát hiện khoản nợ "${worstDebt.name}" có số dư ${worstDebt.balance.toLocaleString('vi-VN')} ₫ với lãi suất ${worstDebt.interestRate}%/năm (tổng nợ lãi cao là ${totalHighDebt.toLocaleString('vi-VN')} ₫).`,
      impact: `Khoản nợ này đang bào mòn dòng tiền của bạn với chi phí lãi khoảng ${annualInterestLoss.toLocaleString('vi-VN')} ₫/năm, triệt tiêu mọi lợi nhuận đầu tư thông thường.`,
      action: `Áp dụng phương pháp Avalanche: trả mức tối thiểu các khoản khác, dồn toàn bộ thặng dư tháng này thanh toán dứt điểm khoản nợ này.`,
      amount: worstDebt.balance,
      deadline: 'Thanh toán trước ngày sao kê tiếp theo',
      assumptionsAndConfidence: `Giả định không phát sinh thêm dư nợ thẻ mới; Mức độ tin cậy: Tuyệt đối (100%).`,
    };

    insights.push({
      id: `insight-debt-${period}`,
      period,
      ruleCode: 'RULE_HIGH_INTEREST_DEBT',
      priorityOrder: 2,
      severity: 'critical',
      title: 'Cần dập tắt khẩn cấp dư nợ lãi suất cao',
      content,
      status: 'new',
    });
  }

  // -------------------------------------------------------------
  // Ưu tiên 3: Chi phí cố định quá cao (> 65% thu nhập thực nhận)
  // -------------------------------------------------------------
  if (metrics.fixedCostRatio > 65) {
    const excessPercent = Number((metrics.fixedCostRatio - 65).toFixed(1));
    const targetFixedBudget = Math.round(metrics.totalNetIncome * 0.65);
    const needToCut = Math.max(0, metrics.fixedExpenses - targetFixedBudget);

    const content: SixPartAdvice = {
      finding: `Chi phí cố định chiếm ${metrics.fixedCostRatio}% thu nhập thực nhận (${metrics.fixedExpenses.toLocaleString('vi-VN')} ₫ / ${metrics.totalNetIncome.toLocaleString('vi-VN')} ₫), vượt trần kiểm soát an toàn 65%.`,
      impact: `Biên độ linh hoạt dòng tiền chỉ còn ${ (100 - metrics.fixedCostRatio).toFixed(1) }%, khiến ngân sách dễ bị vỡ trận khi thu nhập suy giảm hoặc chi phí y tế phát sinh.`,
      action: `Rà soát và thương lượng lại hợp đồng thuê nhà, các gói cước viễn thông, phí dịch vụ định kỳ hoặc gói tập gym không sử dụng thường xuyên.`,
      amount: needToCut,
      deadline: 'Trong vòng 45 ngày tới',
      assumptionsAndConfidence: `Giả định thu nhập thực nhận duy trì mức hiện tại; Mức độ tin cậy: Cao (90%).`,
    };

    insights.push({
      id: `insight-fixed-cost-${period}`,
      period,
      ruleCode: 'RULE_FIXED_EXPENSE_OVERFLOW',
      priorityOrder: 3,
      severity: 'warning',
      title: 'Tỷ lệ chi phí cố định vượt ngưỡng an toàn',
      content,
      status: 'new',
    });
  }

  // -------------------------------------------------------------
  // Ưu tiên 4: Tỷ lệ tiết kiệm thấp (< 20%)
  // -------------------------------------------------------------
  if (metrics.savingsRate < 20) {
    const gapPercent = Number((20 - metrics.savingsRate).toFixed(1));
    const targetSavings = Math.round(metrics.totalNetIncome * 0.20);
    const deficitAmount = Math.max(0, targetSavings - metrics.monthlySavings);

    const content: SixPartAdvice = {
      finding: `Tỷ lệ tiết kiệm tháng này đạt ${metrics.savingsRate}% (${metrics.monthlySavings.toLocaleString('vi-VN')} ₫), thấp hơn mục tiêu chuẩn mực tối thiểu 20.0%.`,
      impact: `Tốc độ gia tăng tài sản ròng bị chậm ${gapPercent}%, kéo dài thời gian hoàn thành các mục tiêu tài chính dài hạn và hưu trí.`,
      action: `Thực hiện nguyên tắc "Pay Yourself First" - tự động chuyển tối thiểu 20% thu nhập sang tài khoản tích lũy riêng ngay khi lương về, trước khi bắt đầu chi tiêu sinh hoạt.`,
      amount: deficitAmount,
      deadline: 'Kỳ nhận lương tháng kế tiếp',
      assumptionsAndConfidence: `Giả định các khoản chi biến đổi không thiết yếu có thể cắt giảm 15%; Mức độ tin cậy: Cao (92%).`,
    };

    insights.push({
      id: `insight-savings-rate-${period}`,
      period,
      ruleCode: 'RULE_SAVINGS_RATE_DEFICIT',
      priorityOrder: 4,
      severity: metrics.savingsRate <= 0 ? 'critical' : 'warning',
      title: 'Tỷ lệ tiết kiệm chưa đạt chuẩn mực 20%',
      content,
      status: 'new',
    });
  }

  // -------------------------------------------------------------
  // Ưu tiên 5: Mục tiêu bị chậm trễ (> 10%) hoặc Tối ưu hóa phân bổ đầu tư
  // -------------------------------------------------------------
  const laggingGoal = goals.find((g) => g.status === 'lagging');
  if (laggingGoal) {
    const content: SixPartAdvice = {
      finding: `Mục tiêu "${laggingGoal.name}" đang bị chậm tiến độ thực tế hơn 10% so với lịch trình (mới đạt ${( (laggingGoal.accumulatedAmount / laggingGoal.targetAmount) * 100 ).toFixed(1)}%).`,
      impact: `Nguy cơ phải lùi thời hạn hoàn thành hoặc phải cắt giảm quy mô mục tiêu khi đến hạn ${laggingGoal.deadline}.`,
      action: `Tăng số tiền trích góp định kỳ cho mục tiêu này hoặc chuyển hướng thặng dư từ các khoản chi tiêu mua sắm biến đổi tháng này.`,
      amount: laggingGoal.requiredMonthlySavings || Math.round((laggingGoal.targetAmount - laggingGoal.accumulatedAmount) / 12),
      deadline: `Trước ngày 30/${laggingGoal.deadline}`,
      assumptionsAndConfidence: `Giả định duy trì kỷ luật tích lũy mỗi tháng; Mức độ tin cậy: Rất cao (94%).`,
    };

    insights.push({
      id: `insight-goal-lag-${period}`,
      period,
      ruleCode: 'RULE_GOAL_PACE_LAGGING',
      priorityOrder: 5,
      severity: 'warning',
      title: `Tiến độ mục tiêu "${laggingGoal.name}" bị chậm trễ`,
      content,
      status: 'new',
    });
  } else if (metrics.savingsRate >= 20 && metrics.emergencyFundMonths >= 3) {
    // Sức khỏe tài chính rất tốt -> Lời khuyên đầu tư gia tăng tài sản
    const investableSurplus = Math.round(metrics.monthlySavings * 0.7);
    const content: SixPartAdvice = {
      finding: `Dòng tiền và quỹ dự phòng đạt trạng thái hoàn hảo (${metrics.emergencyFundMonths.toFixed(1)} tháng dự phòng, tiết kiệm ${metrics.savingsRate}%).`,
      impact: `Nếu để toàn bộ tiền trong tài khoản thanh khoản lãi suất thấp, tài sản sẽ bị lạm phát (khoảng 3.5%/năm) bào mòn giá trị thực tế theo thời gian.`,
      action: `Thiết lập chương trình đầu tư định kỳ (DCA) vào các chứng chỉ quỹ chỉ số VN30/Diamond hoặc danh mục tài sản sinh lời dài hạn có kỷ luật.`,
      amount: investableSurplus,
      deadline: 'Trước ngày 15 tháng tới',
      assumptionsAndConfidence: `Giả định tầm nhìn đầu tư dài hạn trên 5 năm; Mức độ tin cậy: Rất cao (95%).`,
    };

    insights.push({
      id: `insight-invest-dca-${period}`,
      period,
      ruleCode: 'RULE_INVESTMENT_DCA_ACCELERATION',
      priorityOrder: 5,
      severity: 'positive',
      title: 'Tối ưu hóa thặng dư vào danh mục đầu tư tích lũy',
      content,
      status: 'new',
    });
  }

  // Giới hạn tối đa 5 lời khuyên xếp theo ưu tiên
  return insights.slice(0, 5);
}
