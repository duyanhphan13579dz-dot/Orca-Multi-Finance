export interface HealthScoreBreakdown {
  total: number;
  cashflowScore: number;
  emergencyScore: number;
  debtScore: number;
  networthScore: number;
  disciplineScore: number;
  ratingText: string;
}

export function calculateHealthScore(params: {
  savingsRate: number;
  fixedCostRatio: number;
  emergencyFundMonths: number;
  totalDebt: number;
  debtToIncomeRatio: number;
  hasHighInterestDebt: boolean;
  netWorth: number;
  investedAssetsRatio: number;
  hasRecentCheckin: boolean;
  consecutiveCheckinsCount: number;
}): HealthScoreBreakdown {
  let cashflowScore = 0;
  if (params.savingsRate >= 25) cashflowScore += 15;
  else if (params.savingsRate >= 20) cashflowScore += 13;
  else if (params.savingsRate >= 10) cashflowScore += 9;
  else if (params.savingsRate > 0) cashflowScore += 4;
  if (params.fixedCostRatio <= 50) cashflowScore += 10;
  else if (params.fixedCostRatio <= 65) cashflowScore += 7;
  else if (params.fixedCostRatio <= 80) cashflowScore += 3;
  cashflowScore = Math.min(25, cashflowScore);

  let emergencyScore = 0;
  if (params.emergencyFundMonths >= 6) emergencyScore = 25;
  else if (params.emergencyFundMonths >= 3) emergencyScore = 17;
  else if (params.emergencyFundMonths >= 1.5) emergencyScore = 10;
  else if (params.emergencyFundMonths >= 0.5) emergencyScore = 5;
  else emergencyScore = 1;

  let debtScore = 20;
  if (params.totalDebt <= 0) debtScore = 20;
  else if (params.debtToIncomeRatio > 40) debtScore = 5;
  else if (params.debtToIncomeRatio > 30) debtScore = 10;
  else if (params.debtToIncomeRatio > 20) debtScore = 15;
  if (params.hasHighInterestDebt) debtScore = Math.max(0, debtScore - 5);

  let networthScore = 10;
  if (params.netWorth > 0) networthScore += 5;
  if (params.investedAssetsRatio >= 30) networthScore += 5;
  networthScore = Math.min(20, networthScore);

  let disciplineScore = 0;
  if (params.hasRecentCheckin) disciplineScore += 5;
  if (params.consecutiveCheckinsCount >= 3) disciplineScore += 5;
  disciplineScore = Math.min(10, disciplineScore);

  const total = cashflowScore + emergencyScore + debtScore + networthScore + disciplineScore;
  let ratingText = "Cần cải thiện";
  if (total >= 85) ratingText = "Xuất sắc";
  else if (total >= 70) ratingText = "Tốt";
  else if (total >= 55) ratingText = "Ổn định";
  else if (total >= 40) ratingText = "Trung bình";

  return {
    total,
    cashflowScore,
    emergencyScore,
    debtScore,
    networthScore,
    disciplineScore,
    ratingText,
  };
}
