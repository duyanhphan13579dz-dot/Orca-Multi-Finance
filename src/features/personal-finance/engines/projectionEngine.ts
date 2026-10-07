/**
 * Engine Projection: Mô phỏng tài chính dài hạn & hưu trí.
 * 1. Ba kịch bản xác định: Thận trọng, Cơ bản, Tăng trưởng.
 * 2. Mô phỏng Monte Carlo ít nhất 1.000 lượt, xuất dải phân vị P10, P50, P90.
 */

import { AssumptionSet } from '../types/finance.ts';

export interface YearProjectionPoint {
  year: number;
  age: number;
  deterministic: {
    conservative: number;
    base: number;
    aggressive: number;
  };
  monteCarlo: {
    p10: number; // Kịch bản thận trọng / thị trường xấu
    p50: number; // Kịch bản trung vị
    p90: number; // Kịch bản thuận lợi
  };
  cumulativeContributed: number;
}

export interface RetirementAnalysis {
  currentAge: number;
  retirementAge: number;
  yearsToRetirement: number;
  projectedNestEggAtRetirement: number; // P50 at retirement
  estimatedMonthlyRetirementIncome: number; // Safe withdrawal rate (4%/năm hoặc niên kim đến kỳ vọng sống)
  monthlyIncomeGoalAtRetirement: number; // Chi tiêu hiện tại sau trượt giá
  adequacyRatio: number; // % đáp ứng
  isSufficient: boolean;
}

export interface ProjectionResult {
  assumptions: AssumptionSet;
  initialNetWorth: number;
  monthlyContribution: number;
  timeline: YearProjectionPoint[];
  retirement: RetirementAnalysis;
  simulationStats: {
    runs: number;
    annualMeanReturn: number;
    annualVolatility: number;
    inflationApplied: number;
  };
}

export const DEFAULT_ASSUMPTIONS: AssumptionSet = {
  inflationRate: 3.5, // %/năm (mục tiêu điều hành NHNN 3.5 - 4.5%)
  salaryGrowthRate: 6.0, // %/năm
  returnsConservative: 5.5, // %/năm (tiền gửi kỳ hạn 12 tháng)
  returnsBase: 9.0, // %/năm (danh mục hỗn hợp quỹ cổ phiếu/trái phiếu)
  returnsAggressive: 13.0, // %/năm (danh mục cổ phiếu tăng trưởng)
  retirementAge: 62, // Lộ trình Bộ luật Lao động nam 62, nữ 60
  lifeExpectancy: 82, // Kỳ vọng sống bình quân
  sourceNotes: 'Lãi suất huy động Big4 & mục tiêu lạm phát CPI Quốc hội phê duyệt',
  updatedAt: '01/10/2026',
};

// Chuẩn số giả ngẫu nhiên phân phối chuẩn bằng Box-Muller transform
function generateGaussian(mean: number, stdDev: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * stdDev;
}

export function runFinancialProjection(
  initialNetWorth: number,
  monthlyContribution: number,
  birthYear: number = 1996,
  assumptions: AssumptionSet = DEFAULT_ASSUMPTIONS,
  simYears: number = 30,
  monteCarloRuns: number = 1000
): ProjectionResult {
  const currentYear = 2026;
  const currentAge = currentYear - birthYear;
  const yearsToRetire = Math.max(1, assumptions.retirementAge - currentAge);

  const startAssets = Math.max(0, initialNetWorth);
  const annualContribution = Math.max(0, monthlyContribution) * 12;

  const rCons = assumptions.returnsConservative / 100;
  const rBase = assumptions.returnsBase / 100;
  const rAggr = assumptions.returnsAggressive / 100;
  const inf = assumptions.inflationRate / 100;
  const vol = 0.12; // Độ biến động thị trường cổ phiếu/quỹ Việt Nam ~12-14%

  // 1. Chạy 1,000 lượt mô phỏng Monte Carlo
  // Ma trận lưu giá trị tài sản ròng tại mỗi năm cho từng run: [yearIndex 0..simYears][runIndex 0..monteCarloRuns-1]
  const mcSimMatrix: number[][] = Array.from({ length: simYears + 1 }, () => []);

  for (let r = 0; r < monteCarloRuns; r++) {
    let balance = startAssets;
    mcSimMatrix[0].push(balance);

    for (let y = 1; y <= simYears; y++) {
      // Random annual return with normal distribution
      const randomReturn = generateGaussian(rBase, vol);
      // Tăng mức góp hàng năm theo lạm phát/tăng trưởng thu nhập (nhẹ)
      const currentYearContribution = annualContribution * Math.pow(1 + inf * 0.5, y - 1);
      // Tính lãi kép và tiền góp vào giữa năm
      balance = balance * (1 + randomReturn) + currentYearContribution;
      balance = Math.max(0, balance);
      mcSimMatrix[y].push(balance);
    }
  }

  // 2. Tổng hợp timeline từng năm
  const timeline: YearProjectionPoint[] = [];

  let consBal = startAssets;
  let baseBal = startAssets;
  let aggrBal = startAssets;
  let cumulativeContributed = startAssets;

  for (let y = 0; y <= simYears; y++) {
    const age = currentAge + y;

    if (y > 0) {
      const currentYearContribution = annualContribution * Math.pow(1 + inf * 0.5, y - 1);
      cumulativeContributed += currentYearContribution;

      consBal = consBal * (1 + rCons) + currentYearContribution;
      baseBal = baseBal * (1 + rBase) + currentYearContribution;
      aggrBal = aggrBal * (1 + rAggr) + currentYearContribution;
    }

    // Lấy phân vị P10, P50, P90 từ 1000 lượt chạy
    const sortedRuns = [...mcSimMatrix[y]].sort((a, b) => a - b);
    const p10Index = Math.floor(monteCarloRuns * 0.10);
    const p50Index = Math.floor(monteCarloRuns * 0.50);
    const p90Index = Math.floor(monteCarloRuns * 0.90);

    const p10 = Math.round(sortedRuns[p10Index]);
    const p50 = Math.round(sortedRuns[p50Index]);
    const p90 = Math.round(sortedRuns[p90Index]);

    timeline.push({
      year: currentYear + y,
      age,
      deterministic: {
        conservative: Math.round(consBal),
        base: Math.round(baseBal),
        aggressive: Math.round(aggrBal),
      },
      monteCarlo: {
        p10,
        p50,
        p90,
      },
      cumulativeContributed: Math.round(cumulativeContributed),
    });
  }

  // 3. Phân tích hưu trí tại tuổi nghỉ hưu
  const retireYearIndex = Math.min(simYears, yearsToRetire);
  const retirePoint = timeline[retireYearIndex];
  const nestEgg = retirePoint ? retirePoint.monteCarlo.p50 : 0;

  // Quy tắc rút vốn an toàn 4%/năm (Trinity Study) hoặc chia đều theo số năm kỳ vọng sống
  const retirementDurationYears = Math.max(5, assumptions.lifeExpectancy - assumptions.retirementAge);
  const safeAnnualWithdrawal = nestEgg * 0.04;
  const estimatedMonthlyRetirementIncome = Math.round(safeAnnualWithdrawal / 12);

  // Chi tiêu mục tiêu tuổi hưu: giả định 20 triệu/tháng theo giá trị tiền tương lai
  const assumedCurrentExpense = 18000000;
  const monthlyIncomeGoalAtRetirement = Math.round(
    assumedCurrentExpense * Math.pow(1 + inf, yearsToRetire)
  );

  const adequacyRatio = monthlyIncomeGoalAtRetirement > 0
    ? Number(((estimatedMonthlyRetirementIncome / monthlyIncomeGoalAtRetirement) * 100).toFixed(1))
    : 0;

  const retirement: RetirementAnalysis = {
    currentAge,
    retirementAge: assumptions.retirementAge,
    yearsToRetirement: yearsToRetire,
    projectedNestEggAtRetirement: nestEgg,
    estimatedMonthlyRetirementIncome,
    monthlyIncomeGoalAtRetirement,
    adequacyRatio,
    isSufficient: adequacyRatio >= 85,
  };

  return {
    assumptions,
    initialNetWorth: startAssets,
    monthlyContribution,
    timeline,
    retirement,
    simulationStats: {
      runs: monteCarloRuns,
      annualMeanReturn: assumptions.returnsBase,
      annualVolatility: Math.round(vol * 100),
      inflationApplied: assumptions.inflationRate,
    },
  };
}
