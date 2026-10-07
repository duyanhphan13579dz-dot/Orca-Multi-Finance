/**
 * Orca Personal Finance - Core Data Models (B4)
 * Strict typing according to Master Prompt specification
 */

export type MaritalStatus = 'single' | 'married' | 'has_children';
export type EmploymentType = 'salaried' | 'freelance' | 'business_owner' | 'other';
export type RiskTolerance = 'conservative' | 'moderate' | 'growth' | 'aggressive';

export interface FinanceProfile {
  birthYear: number;
  maritalStatus: MaritalStatus;
  dependentsCount: number;
  employmentType: EmploymentType;
  riskTolerance: RiskTolerance;
  // Privacy & Consent (B7)
  consentStorage: boolean;
  consentAI: boolean;
  consentOpenBanking: boolean;
  updatedAt: string;
}

export interface IncomeEntry {
  period: string; // YYYY-MM
  grossSalary: number; // Lương gộp
  bonus: number; // Thưởng
  otherIncome: number; // Thu nhập khác
  insuranceSalaryBase: number; // Mức lương đóng bảo hiểm (hoặc 0 nếu bằng grossSalary)
  dependentsCount: number; // Số người phụ thuộc đăng ký
  // Engine-calculated fields:
  mandatoryInsurance: {
    bhxh: number; // 8%
    bhyt: number; // 1.5%
    bhtn: number; // 1%
    total: number; // 10.5%
    isCapped: boolean;
  };
  personalIncomeTax: number; // Thuế TNCN lũy tiến 5 bậc (2026 params)
  netTakeHome: number; // Thu nhập thực nhận
}

export type ExpenseCategoryKey =
  | 'housing'
  | 'utilities'
  | 'food'
  | 'transport'
  | 'education'
  | 'healthcare'
  | 'insurance'
  | 'entertainment'
  | 'shopping'
  | 'family_support'
  | 'other';

export interface ExpenseItem {
  id: string;
  category: ExpenseCategoryKey;
  name: string;
  amount: number;
  isFixed: boolean; // Cờ cố định (true) hoặc biến đổi (false)
}

export type AssetCategoryKey =
  | 'cash'
  | 'savings'
  | 'gold'
  | 'stocks'
  | 'funds'
  | 'real_estate'
  | 'crypto'
  | 'other';

export interface AssetItem {
  id: string;
  category: AssetCategoryKey;
  name: string;
  balance: number;
  updatedAt: string; // dd/MM/yyyy
  interestRate?: number; // %/năm nếu có (tiền gửi, trái phiếu)
  sourceNote?: string;
  // Note: Không lưu số tài khoản theo nguyên tắc B5/B7
}

export type DebtCategoryKey =
  | 'credit_card'
  | 'mortgage'
  | 'car_loan'
  | 'consumer_loan'
  | 'relative_loan'
  | 'other';

export interface DebtItem {
  id: string;
  category: DebtCategoryKey;
  name: string;
  balance: number; // Dư nợ hiện tại
  interestRate: number; // %/năm
  minMonthlyPayment: number; // Trả tối thiểu mỗi tháng
  remainingMonths: number; // Số tháng còn lại
}

export type GoalPriority = 'high' | 'medium' | 'low';
export type GoalStatus = 'on_track' | 'lagging' | 'completed' | 'paused';

export interface FinancialGoal {
  id: string;
  name: string;
  targetAmount: number;
  accumulatedAmount: number;
  deadline: string; // YYYY-MM
  priority: GoalPriority;
  status: GoalStatus;
  lagPercent?: number; // % chậm trễ nếu > 10%
  requiredMonthlySavings?: number; // Engine tính
}

export interface AssumptionSet {
  inflationRate: number; // %/năm (mặc định 3.5%)
  salaryGrowthRate: number; // %/năm (mặc định 6.0%)
  returnsConservative: number; // %/năm (mặc định 5.5% - tiền gửi/trái phiếu)
  returnsBase: number; // %/năm (mặc định 9.0% - danh mục cân bằng)
  returnsAggressive: number; // %/năm (mặc định 13.0% - cổ phiếu/quỹ mở)
  retirementAge: number; // Tuổi nghỉ hưu (mặc định 62 với nam, 60 với nữ theo lộ trình BLLĐ)
  lifeExpectancy: number; // Tuổi thọ dự kiến (mặc định 82)
  sourceNotes: string;
  updatedAt: string;
}

export interface CalculatedMetrics {
  totalGrossIncome: number;
  totalNetIncome: number;
  totalExpenses: number;
  fixedExpenses: number;
  variableExpenses: number;
  monthlySavings: number;
  savingsRate: number; // %
  fixedCostRatio: number; // %
  totalAssets: number;
  liquidAssets: number;
  investedAssets: number;
  totalDebt: number;
  netWorth: number; // Assets - Debt
  emergencyFundMonths: number; // Liquid assets / Essential monthly expenses
  debtToIncomeRatio: number; // Min debt payments / Net income
  healthScore: {
    total: number; // 0 - 100
    cashflowScore: number; // max 25
    emergencyScore: number; // max 25
    debtScore: number; // max 20
    networthScore: number; // max 20
    disciplineScore: number; // max 10
    ratingText: string;
  };
}

export interface SixPartAdvice {
  finding: string; // Phát hiện (số liệu)
  impact: string; // Tác động
  action: string; // Hành động cụ thể
  amount: number; // Số tiền (₫)
  deadline: string; // Thời hạn
  assumptionsAndConfidence: string; // Giả định & Mức tin cậy
}

export interface Insight {
  id: string;
  period: string; // YYYY-MM
  ruleCode: string;
  priorityOrder: number; // 1 - 5 (1 cao nhất)
  severity: 'critical' | 'warning' | 'info' | 'positive';
  title: string;
  content: SixPartAdvice;
  status: 'new' | 'completed' | 'dismissed';
}

export interface MonthlySnapshot {
  period: string; // YYYY-MM
  profile: FinanceProfile;
  income: IncomeEntry;
  expenses: ExpenseItem[];
  assets: AssetItem[];
  debts: DebtItem[];
  goals: FinancialGoal[];
  metrics: CalculatedMetrics;
  engineVersion: string; // e.g. "orca-engine-v2026.1"
  timestamp: string;
  narrativeSummary?: string;
  isDemo?: boolean;
}

export interface MarketRateItem {
  title: string;
  rate: string;
  change: string;
  source: string;
  updatedAt: string;
}
