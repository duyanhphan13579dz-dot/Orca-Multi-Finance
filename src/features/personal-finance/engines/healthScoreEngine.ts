/**
 * Engine Health-Score: Chấm điểm sức khỏe tài chính 0–100 theo 5 nhóm trọng số cấu hình.
 * - Dòng tiền: trọng số 25
 * - Dự phòng & Khẩn cấp: trọng số 25
 * - Nợ vay: trọng số 20
 * - Tích lũy & Tài sản ròng: trọng số 20
 * - Kỷ luật cập nhật: trọng số 10
 */

export interface HealthScoreBreakdown {
  total: number; // 0 - 100
  cashflowScore: number; // max 25
  emergencyScore: number; // max 25
  debtScore: number; // max 20
  networthScore: number; // max 20
  disciplineScore: number; // max 10
  ratingBand: 'Xuất sắc' | 'Tốt' | 'Trung bình' | 'Cần cải thiện' | 'Báo động';
  ratingColor: string;
  summaryFeedback: string;
  pillarDetails: {
    cashflow: { current: number; max: 25; notes: string };
    emergency: { current: number; max: 25; notes: string };
    debt: { current: number; max: 20; notes: string };
    networth: { current: number; max: 20; notes: string };
    discipline: { current: number; max: 10; notes: string };
  };
}

export function calculateHealthScore(params: {
  netIncome: number;
  savingsRate: number; // %
  fixedCostRatio: number; // %
  emergencyFundMonths: number;
  totalDebt: number;
  debtToIncomeRatio: number; // %
  hasHighInterestDebt: boolean;
  netWorth: number;
  investedAssetsRatio: number; // %
  hasRecentCheckin: boolean;
  consecutiveCheckinsCount: number;
}): HealthScoreBreakdown {
  const {
    savingsRate,
    fixedCostRatio,
    emergencyFundMonths,
    totalDebt,
    debtToIncomeRatio,
    hasHighInterestDebt,
    netWorth,
    investedAssetsRatio,
    hasRecentCheckin,
    consecutiveCheckinsCount,
  } = params;

  // 1. Dòng tiền (Trọng số 25)
  let cashflowScore = 0;
  // Tiết kiệm: max 15đ
  if (savingsRate >= 25) cashflowScore += 15;
  else if (savingsRate >= 20) cashflowScore += 13;
  else if (savingsRate >= 10) cashflowScore += 9;
  else if (savingsRate > 0) cashflowScore += 4;
  else cashflowScore += 0;

  // Chi phí cố định: max 10đ (mục tiêu <= 50-60%)
  if (fixedCostRatio <= 50) cashflowScore += 10;
  else if (fixedCostRatio <= 65) cashflowScore += 7;
  else if (fixedCostRatio <= 80) cashflowScore += 3;
  else cashflowScore += 0;

  cashflowScore = Math.min(25, Math.max(0, cashflowScore));

  // 2. Quỹ khẩn cấp & Dự phòng (Trọng số 25)
  let emergencyScore = 0;
  if (emergencyFundMonths >= 6) emergencyScore = 25;
  else if (emergencyFundMonths >= 4.5) emergencyScore = 21;
  else if (emergencyFundMonths >= 3) emergencyScore = 17;
  else if (emergencyFundMonths >= 1.5) emergencyScore = 10;
  else if (emergencyFundMonths >= 0.5) emergencyScore = 5;
  else emergencyScore = 1;

  // 3. Gánh nặng nợ (Trọng số 20)
  let debtScore = 0;
  if (totalDebt === 0) {
    debtScore = 20; // Hoàn toàn không có nợ
  } else {
    // DTI < 15%: 15đ, 15-30%: 11đ, 30-45%: 6đ, >45%: 1đ
    if (debtToIncomeRatio <= 15) debtScore = 15;
    else if (debtToIncomeRatio <= 30) debtScore = 11;
    else if (debtToIncomeRatio <= 45) debtScore = 6;
    else debtScore = 2;

    // Trừ 5 điểm nếu có nợ thẻ tín dụng / vay tiêu dùng lãi suất cao (>12%)
    if (hasHighInterestDebt) {
      debtScore = Math.max(0, debtScore - 5);
    }
  }

  // 4. Tích lũy & Tài sản ròng (Trọng số 20)
  let networthScore = 0;
  if (netWorth > 0) {
    networthScore += 10;
    // Tỷ lệ tài sản sinh lời: max 10đ
    if (investedAssetsRatio >= 40) networthScore += 10;
    else if (investedAssetsRatio >= 20) networthScore += 7;
    else if (investedAssetsRatio > 0) networthScore += 4;
    else networthScore += 2;
  } else {
    networthScore = 2; // Tài sản ròng âm
  }
  networthScore = Math.min(20, Math.max(0, networthScore));

  // 5. Kỷ luật cập nhật (Trọng số 10)
  let disciplineScore = 0;
  if (hasRecentCheckin) disciplineScore += 5;
  if (consecutiveCheckinsCount >= 3) disciplineScore += 5;
  else if (consecutiveCheckinsCount >= 1) disciplineScore += 3;

  disciplineScore = Math.min(10, Math.max(0, disciplineScore));

  const total = cashflowScore + emergencyScore + debtScore + networthScore + disciplineScore;

  let ratingBand: HealthScoreBreakdown['ratingBand'] = 'Trung bình';
  let ratingColor = '#d4af37'; // gold
  let summaryFeedback = '';

  if (total >= 85) {
    ratingBand = 'Xuất sắc';
    ratingColor = '#10b981'; // green
    summaryFeedback = 'Hồ sơ tài chính cực kỳ vững chắc, dòng tiền và quỹ dự phòng đạt tiêu chuẩn tổ chức cao nhất.';
  } else if (total >= 70) {
    ratingBand = 'Tốt';
    ratingColor = '#38bdf8'; // sky blue
    summaryFeedback = 'Cơ cấu tài chính lành mạnh. Hãy tiếp tục củng cố quỹ đầu tư và tối ưu hóa chi phí cố định.';
  } else if (total >= 50) {
    ratingBand = 'Trung bình';
    ratingColor = '#d4af37'; // gold
    summaryFeedback = 'Cần gia cố thêm quỹ dự phòng khẩn cấp và nâng cao tỷ lệ tiết kiệm hàng tháng.';
  } else if (total >= 35) {
    ratingBand = 'Cần cải thiện';
    ratingColor = '#f97316'; // orange
    summaryFeedback = 'Gặp áp lực về dòng tiền hoặc dự phòng dưới 3 tháng. Cần rà soát ngay chi phí biến đổi và giảm nợ.';
  } else {
    ratingBand = 'Báo động';
    ratingColor = '#ef4444'; // red
    summaryFeedback = 'Dòng tiền căng thẳng và mức độ rủi ro cao. Cần tái cấu trúc khẩn cấp các khoản nợ và cắt giảm chi tiêu.';
  }

  return {
    total,
    cashflowScore,
    emergencyScore,
    debtScore,
    networthScore,
    disciplineScore,
    ratingBand,
    ratingColor,
    summaryFeedback,
    pillarDetails: {
      cashflow: {
        current: cashflowScore,
        max: 25,
        notes: `Tỷ lệ tiết kiệm ${savingsRate}%, chi phí cố định ${fixedCostRatio}% thu nhập.`,
      },
      emergency: {
        current: emergencyScore,
        max: 25,
        notes: `Dự phòng thanh khoản tương đương ${emergencyFundMonths} tháng chi tiêu thiết yếu.`,
      },
      debt: {
        current: debtScore,
        max: 20,
        notes: totalDebt === 0
          ? 'Không có nợ.'
          : `Tỷ lệ trả nợ/thu nhập ${debtToIncomeRatio}%. ${hasHighInterestDebt ? 'Có dư nợ lãi suất cao.' : 'Nợ trong tầm kiểm soát.'}`,
      },
      networth: {
        current: networthScore,
        max: 20,
        notes: `Tài sản ròng ${netWorth > 0 ? 'dương' : 'âm/bằng không'}, ${investedAssetsRatio}% là tài sản sinh lời.`,
      },
      discipline: {
        current: disciplineScore,
        max: 10,
        notes: `Đã duy trì ${consecutiveCheckinsCount} kỳ Monthly Check-in liên tiếp.`,
      },
    },
  };
}
