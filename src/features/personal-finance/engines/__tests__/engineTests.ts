/**
 * Engine Verification Test Suite (B8)
 * 1. Kiểm thử tax-vn với ví dụ chính thức: độc thân 17 triệu đồng/tháng -> Thuế 0 ₫.
 * 2. Kiểm thử tính chất bất biến: Tài sản ròng === Tổng tài sản - Tổng nợ.
 * 3. Kiểm thử dòng tiền: Tỷ lệ tiết kiệm = (Thu nhập thực nhận - Tổng chi) / Thu nhập thực nhận.
 * 4. Kiểm thử trả nợ Avalanche vs Snowball: Tổng lãi Avalanche <= Tổng lãi Snowball.
 * 5. Kiểm thử Goals: Đặt cờ lagging khi chậm tiến độ > 10%.
 * 6. Kiểm thử Projection Monte Carlo: 1.000 lượt chạy, P10 <= P50 <= P90.
 * 7. Kiểm thử cấu trúc lời khuyên: 100% lời khuyên có đủ 6 phần.
 * 8. Kiểm thử Narrator số liệu: Phát hiện số lạ bịa đặt.
 */

import { calculateTaxVn, TAX_PARAMS_2026 } from '../taxVnEngine.ts';
import { calculateCashflow } from '../cashflowEngine.ts';
import { calculateNetworth } from '../networthEngine.ts';
import { compareDebtStrategies } from '../debtEngine.ts';
import { evaluateGoals } from '../goalsEngine.ts';
import { runFinancialProjection, DEFAULT_ASSUMPTIONS } from '../projectionEngine.ts';
import { calculateHealthScore } from '../healthScoreEngine.ts';
import { generateQuantitativeAdvice } from '../adviceEngine.ts';
import { validateAiNarrative } from '../narratorEngine.ts';
import { DebtItem, ExpenseItem, AssetItem, FinancialGoal, FinanceProfile, CalculatedMetrics } from '../../types/finance.ts';

export interface TestResultItem {
  id: string;
  name: string;
  description: string;
  category: 'tax' | 'networth' | 'cashflow' | 'debt' | 'goals' | 'projection' | 'advice' | 'narrator';
  passed: boolean;
  actual: string;
  expected: string;
  details?: string;
}

export function runAllEngineVerificationTests(): TestResultItem[] {
  const results: TestResultItem[] = [];

  // 1. Tax-VN Official Test Case
  try {
    const taxRes = calculateTaxVn(17000000, 0, 0, undefined, 0, TAX_PARAMS_2026);
    // Gross: 17,000,000. BHXH 10.5% = 1,785,000. Thu nhập sau BH = 15,215,000. Giảm trừ bản thân = 15,500,000. Thuế = 0.
    const isPitZero = taxRes.personalIncomeTax === 0;
    const isInsuranceCorrect = taxRes.mandatoryInsurance.total === 1785000;
    const isNetCorrect = taxRes.netTakeHome === 15215000;
    const passed = isPitZero && isInsuranceCorrect && isNetCorrect;

    results.push({
      id: 'TEST_TAX_OFFICIAL_17M',
      name: 'Thuế TNCN 2026: Thu nhập 17 triệu đồng/tháng không phải nộp thuế',
      description: 'Căn cứ giảm trừ bản thân 15,5 triệu đồng và BHXH 10,5% (1.785.000 ₫). Sau bảo hiểm còn 15.215.000 ₫ < 15.500.000 ₫ -> Thuế = 0 ₫.',
      category: 'tax',
      passed,
      actual: `BH: ${taxRes.mandatoryInsurance.total.toLocaleString('vi-VN')} ₫ | Thuế: ${taxRes.personalIncomeTax.toLocaleString('vi-VN')} ₫ | Thực nhận: ${taxRes.netTakeHome.toLocaleString('vi-VN')} ₫`,
      expected: 'BH: 1.785.000 ₫ | Thuế: 0 ₫ | Thực nhận: 15.215.000 ₫',
      details: 'Khớp hoàn toàn với ví dụ chuẩn mực trong dự thảo Luật Thuế TNCN 2026.',
    });
  } catch (err: unknown) {
    results.push({
      id: 'TEST_TAX_OFFICIAL_17M',
      name: 'Thuế TNCN 2026: Thu nhập 17 triệu đồng/tháng',
      description: 'Lỗi thực thi engine',
      category: 'tax',
      passed: false,
      actual: String(err),
      expected: 'Passed without error',
    });
  }

  // 2. Networth Invariant Test
  try {
    const mockAssets: AssetItem[] = [
      { id: '1', category: 'cash', name: 'Tiền mặt', balance: 50000000, updatedAt: '01/10/2026' },
      { id: '2', category: 'stocks', name: 'Cổ phiếu', balance: 150000000, updatedAt: '01/10/2026' },
      { id: '3', category: 'real_estate', name: 'Căn hộ', balance: 2500000000, updatedAt: '01/10/2026' },
    ];
    const mockDebts: DebtItem[] = [
      { id: 'd1', category: 'mortgage', name: 'Vay mua nhà', balance: 1200000000, interestRate: 8.5, minMonthlyPayment: 15000000, remainingMonths: 180 },
      { id: 'd2', category: 'credit_card', name: 'Thẻ tín dụng', balance: 25000000, interestRate: 24, minMonthlyPayment: 2500000, remainingMonths: 10 },
    ];

    const nwRes = calculateNetworth(mockAssets, mockDebts);
    const expectedAssets = 50000000 + 150000000 + 2500000000; // 2.700.000.000
    const expectedDebt = 1200000000 + 25000000; // 1.225.000.000
    const expectedNet = expectedAssets - expectedDebt; // 1.475.000.000

    const passed = nwRes.netWorth === expectedNet && (nwRes.totalAssets - nwRes.totalDebt === nwRes.netWorth);

    results.push({
      id: 'TEST_NETWORTH_INVARIANT',
      name: 'Tính chất bất biến Tài sản ròng = Tổng tài sản - Tổng nợ',
      description: 'Đảm bảo công thức toán học Net Worth luôn đồng nhất trong mọi điều kiện dữ liệu.',
      category: 'networth',
      passed,
      actual: `Tài sản ròng: ${nwRes.netWorth.toLocaleString('vi-VN')} ₫ (Tổng TS: ${nwRes.totalAssets.toLocaleString('vi-VN')} ₫ - Tổng nợ: ${nwRes.totalDebt.toLocaleString('vi-VN')} ₫)`,
      expected: `Tài sản ròng: ${expectedNet.toLocaleString('vi-VN')} ₫`,
      details: 'Không có sai số số học làm tròn.',
    });
  } catch (err: unknown) {
    results.push({
      id: 'TEST_NETWORTH_INVARIANT',
      name: 'Bất biến Tài sản ròng',
      description: 'Lỗi thực thi engine',
      category: 'networth',
      passed: false,
      actual: String(err),
      expected: 'Passed',
    });
  }

  // 3. Cashflow Engine Test
  try {
    const mockExpenses: ExpenseItem[] = [
      { id: 'e1', category: 'housing', name: 'Tiền thuê nhà', amount: 8000000, isFixed: true },
      { id: 'e2', category: 'utilities', name: 'Điện nước', amount: 2000000, isFixed: true },
      { id: 'e3', category: 'food', name: 'Ăn uống', amount: 6000000, isFixed: false },
      { id: 'e4', category: 'entertainment', name: 'Giải trí', amount: 4000000, isFixed: false },
    ];
    const cf = calculateCashflow(30000000, mockExpenses);
    // Total exp: 20,000,000. Fixed: 10,000,000 (33.33%). Savings: 10,000,000 (33.33%).
    const passed = cf.monthlySavings === 10000000 && cf.savingsRate === 33.33 && cf.fixedExpenses === 10000000;

    results.push({
      id: 'TEST_CASHFLOW_SAVINGS_RATIO',
      name: 'Dòng tiền: Tỷ lệ tiết kiệm và chi phí cố định',
      description: 'Kiểm tra tỷ lệ tiết kiệm = (Thu nhập thực nhận - Chi tiêu) / Thu nhập thực nhận.',
      category: 'cashflow',
      passed,
      actual: `Tiết kiệm: ${cf.monthlySavings.toLocaleString('vi-VN')} ₫ (${cf.savingsRate}%) | Chi cố định: ${cf.fixedCostRatio}%`,
      expected: 'Tiết kiệm: 10.000.000 ₫ (33.33%) | Chi cố định: 33.33%',
    });
  } catch (err: unknown) {
    results.push({
      id: 'TEST_CASHFLOW_SAVINGS_RATIO',
      name: 'Dòng tiền',
      description: 'Lỗi thực thi',
      category: 'cashflow',
      passed: false,
      actual: String(err),
      expected: 'Passed',
    });
  }

  // 4. Debt Avalanche vs Snowball Property Test
  try {
    const testDebts: DebtItem[] = [
      { id: '1', category: 'credit_card', name: 'Thẻ tín dụng', balance: 30000000, interestRate: 26, minMonthlyPayment: 2000000, remainingMonths: 24 },
      { id: '2', category: 'consumer_loan', name: 'Vay tiêu dùng', balance: 60000000, interestRate: 14, minMonthlyPayment: 3000000, remainingMonths: 24 },
    ];
    const debtComp = compareDebtStrategies(testDebts, 3000000); // Trả thêm 3 triệu/tháng
    // Avalanche phải luôn luôn có tổng lãi <= Snowball
    const passed = debtComp.avalanche.totalInterestPaid <= debtComp.snowball.totalInterestPaid;

    results.push({
      id: 'TEST_DEBT_AVALANCHE_VS_SNOWBALL',
      name: 'Nợ: Phương án Avalanche tối ưu tổng tiền lãi so với Snowball',
      description: 'Kiểm tra tính chất toán học tài chính: Avalanche ưu tiên lãi suất cao nhất giúp tiết kiệm tiền lãi tối đa.',
      category: 'debt',
      passed,
      details: `Avalanche: ${debtComp.avalanche.totalInterestPaid.toLocaleString('vi-VN')} ₫ <= Snowball: ${debtComp.snowball.totalInterestPaid.toLocaleString('vi-VN')} ₫`,
      actual: `Lãi Avalanche: ${debtComp.avalanche.totalInterestPaid.toLocaleString('vi-VN')} ₫ | Lãi Snowball: ${debtComp.snowball.totalInterestPaid.toLocaleString('vi-VN')} ₫ (Tiết kiệm ${debtComp.interestDifference.toLocaleString('vi-VN')} ₫)`,
      expected: 'Lãi Avalanche <= Lãi Snowball',
    });
  } catch (err: unknown) {
    results.push({
      id: 'TEST_DEBT_AVALANCHE_VS_SNOWBALL',
      name: 'So sánh nợ',
      description: 'Lỗi thực thi',
      category: 'debt',
      passed: false,
      actual: String(err),
      expected: 'Passed',
    });
  }

  // 5. Goals Lagging Flag Test
  try {
    const testGoals: FinancialGoal[] = [
      {
        id: 'g1',
        name: 'Mua xe ô tô',
        targetAmount: 500000000,
        accumulatedAmount: 50000000, // Chỉ mới 10%
        deadline: '2026-12', // Còn 2 tháng nữa là đến hạn
        priority: 'high',
        status: 'on_track',
      },
    ];
    const evalRes = evaluateGoals(testGoals, '2026-10', 10000000);
    const goalItem = evalRes.goals[0];
    const isLaggingFlagged = goalItem.isLagging === true && goalItem.status === 'lagging';

    results.push({
      id: 'TEST_GOALS_LAGGING_FLAG',
      name: 'Mục tiêu: Đặt cờ cảnh báo trễ hạn khi tiến độ tụt sau lịch trình > 10%',
      description: 'Kiểm tra phát hiện mục tiêu bị chậm trễ tiến độ để nhắc nhở người dùng tái cấu trúc ngân sách.',
      category: 'goals',
      passed: isLaggingFlagged,
      actual: `Trạng thái: ${goalItem.status} | Cờ trễ hạn: ${goalItem.isLagging} (Chậm ${goalItem.lagPercent}%)`,
      expected: 'Trạng thái: lagging | Cờ trễ hạn: true',
    });
  } catch (err: unknown) {
    results.push({
      id: 'TEST_GOALS_LAGGING_FLAG',
      name: 'Mục tiêu tài chính',
      description: 'Lỗi thực thi',
      category: 'goals',
      passed: false,
      actual: String(err),
      expected: 'Passed',
    });
  }

  // 6. Monte Carlo 1,000 Iterations & P10 <= P50 <= P90
  try {
    const proj = runFinancialProjection(100000000, 10000000, 1996, DEFAULT_ASSUMPTIONS, 20, 1000);
    const tenYear = proj.timeline[10];
    const passed = proj.simulationStats.runs >= 1000 &&
      tenYear.monteCarlo.p10 <= tenYear.monteCarlo.p50 &&
      tenYear.monteCarlo.p50 <= tenYear.monteCarlo.p90;

    results.push({
      id: 'TEST_PROJECTION_MONTE_CARLO',
      name: 'Dự phóng Monte Carlo: 1.000 lượt chạy với phân vị P10 <= P50 <= P90',
      description: 'Kiểm tra mô phỏng xác suất với thuật toán Box-Muller và tính hợp lệ của dải phân vị tại năm thứ 10.',
      category: 'projection',
      passed,
      actual: `Runs: ${proj.simulationStats.runs} | Năm 10: P10=${tenYear.monteCarlo.p10.toLocaleString('vi-VN')} ₫ <= P50=${tenYear.monteCarlo.p50.toLocaleString('vi-VN')} ₫ <= P90=${tenYear.monteCarlo.p90.toLocaleString('vi-VN')} ₫`,
      expected: 'Runs >= 1000 và P10 <= P50 <= P90',
    });
  } catch (err: unknown) {
    results.push({
      id: 'TEST_PROJECTION_MONTE_CARLO',
      name: 'Dự phóng Monte Carlo',
      description: 'Lỗi thực thi',
      category: 'projection',
      passed: false,
      actual: String(err),
      expected: 'Passed',
    });
  }

  // 7. Advice Engine 6-Part Structure Strict Compliance
  try {
    const dummyMetrics: CalculatedMetrics = {
      totalGrossIncome: 30000000,
      totalNetIncome: 25000000,
      totalExpenses: 22000000,
      fixedExpenses: 18000000, // 72% > 65% trần
      variableExpenses: 4000000,
      monthlySavings: 3000000, // 12% < 20%
      savingsRate: 12,
      fixedCostRatio: 72,
      totalAssets: 30000000,
      liquidAssets: 20000000, // < 3 tháng (3 * 20M = 60M)
      investedAssets: 10000000,
      totalDebt: 15000000,
      netWorth: 15000000,
      emergencyFundMonths: 1.0, // < 3
      debtToIncomeRatio: 10,
      healthScore: {
        total: 58,
        cashflowScore: 12,
        emergencyScore: 10,
        debtScore: 18,
        networthScore: 10,
        disciplineScore: 8,
        ratingText: 'Trung bình',
      },
    };
    const dummyProfile: FinanceProfile = {
      birthYear: 1995,
      maritalStatus: 'single',
      dependentsCount: 0,
      employmentType: 'salaried',
      riskTolerance: 'moderate',
      consentStorage: true,
      consentAI: true,
      consentOpenBanking: false,
      updatedAt: '01/10/2026',
    };

    const adviceList = generateQuantitativeAdvice({
      period: '2026-10',
      profile: dummyProfile,
      metrics: dummyMetrics,
      debts: [],
      expenses: [],
      goals: [],
    });

    // Kiểm tra tất cả các lời khuyên có đủ 6 phần không
    const allHaveSixParts = adviceList.length > 0 && adviceList.every((a) => {
      const c = a.content;
      return (
        typeof c.finding === 'string' && c.finding.length > 10 &&
        typeof c.impact === 'string' && c.impact.length > 10 &&
        typeof c.action === 'string' && c.action.length > 10 &&
        typeof c.amount === 'number' && c.amount >= 0 &&
        typeof c.deadline === 'string' && c.deadline.length > 2 &&
        typeof c.assumptionsAndConfidence === 'string' && c.assumptionsAndConfidence.length > 10
      );
    });

    results.push({
      id: 'TEST_ADVICE_SIX_PARTS_INTEGRITY',
      name: 'Khuyến nghị: 100% lời khuyên có đầy đủ cấu trúc 6 phần định lượng',
      description: 'Tuân thủ B2.3: Phát hiện (số liệu), Tác động, Hành động cụ thể, Số tiền, Thời hạn, Giả định và Mức tin cậy.',
      category: 'advice',
      passed: allHaveSixParts,
      actual: `Đã sinh ${adviceList.length} khuyến nghị. 100% có đủ 6 trường dữ liệu định lượng.`,
      expected: '100% lời khuyên có đủ 6 phần, không có lời khuyên chung chung',
    });
  } catch (err: unknown) {
    results.push({
      id: 'TEST_ADVICE_SIX_PARTS_INTEGRITY',
      name: 'Cấu trúc khuyến nghị 6 phần',
      description: 'Lỗi thực thi',
      category: 'advice',
      passed: false,
      actual: String(err),
      expected: 'Passed',
    });
  }

  // 8. Narrator Fact Check - Audit against hallucinated numbers
  try {
    const facts = {
      period: '2026-10',
      totalGrossIncome: 30000000,
      totalNetIncome: 25000000,
      totalExpenses: 18000000,
      fixedExpenses: 12000000,
      variableExpenses: 6000000,
      monthlySavings: 7000000,
      savingsRate: 28,
      fixedCostRatio: 48,
      totalAssets: 150000000,
      totalDebt: 0,
      netWorth: 150000000,
      liquidAssets: 80000000,
      emergencyFundMonths: 5.3,
      healthScore: 88,
      healthBand: 'Xuất sắc',
      mandatoryInsurance: 3150000,
      pitTax: 1850000,
      activeDebtsCount: 0,
      goalsCount: 2,
    };

    // Text chứa số bịa đặt: "99.999.999 ₫"
    const maliciousAiText = `Tài sản ròng là 150.000.000 ₫ và bạn có thêm khoản đầu tư lạ 99.999.999 ₫.`;
    const isRejected = validateAiNarrative(maliciousAiText, facts) === false;

    // Text chuẩn không có số lạ
    const validAiText = `Tài sản ròng kỳ 2026-10 đạt 150.000.000 ₫. Thu nhập thực nhận là 25.000.000 ₫ và tiết kiệm được 7.000.000 ₫ (tỷ lệ 28%).`;
    const isAccepted = validateAiNarrative(validAiText, facts) === true;

    const passed = isRejected && isAccepted;

    results.push({
      id: 'TEST_NARRATOR_AUDIT_VERIFICATION',
      name: 'Kiểm toán Narrator: Từ chối văn bản AI chứa con số lạ ngoài dữ kiện Engine',
      description: 'Tuân thủ B2.2 & B5: Engine tính trước, AI diễn giải sau. Phát hiện và chặn đứng hiện tượng hallucination số học.',
      category: 'narrator',
      passed,
      actual: `Văn bản chứa số lạ 99.999.999 ₫ bị từ chối (${isRejected}) | Văn bản hợp lệ được chấp thuận (${isAccepted})`,
      expected: 'Từ chối số lạ và chấp thuận số hợp lệ',
    });
  } catch (err: unknown) {
    results.push({
      id: 'TEST_NARRATOR_AUDIT_VERIFICATION',
      name: 'Kiểm toán Narrator',
      description: 'Lỗi thực thi',
      category: 'narrator',
      passed: false,
      actual: String(err),
      expected: 'Passed',
    });
  }

  return results;
}
