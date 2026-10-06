/**
 * Orca Personal Finance - Core Data Models (B4)
 */

export type MaritalStatus = "single" | "married" | "has_children";
export type EmploymentType = "salaried" | "freelance" | "business_owner" | "other";
export type RiskTolerance = "conservative" | "moderate" | "growth" | "aggressive";

export interface FinanceProfile {
  birthYear: number;
  maritalStatus: MaritalStatus;
  dependentsCount: number;
  employmentType: EmploymentType;
  riskTolerance: RiskTolerance;
  consentStorage: boolean;
  consentAI: boolean;
  consentOpenBanking: boolean;
  updatedAt: string;
}

export interface IncomeEntry {
  period: string;
  grossSalary: number;
  bonus: number;
  otherIncome: number;
  insuranceSalaryBase: number;
  dependentsCount: number;
  mandatoryInsurance: {
    bhxh: number;
    bhyt: number;
    bhtn: number;
    total: number;
    isCapped: boolean;
  };
  personalIncomeTax: number;
  netTakeHome: number;
}

export type ExpenseCategoryKey =
  | "housing"
  | "utilities"
  | "food"
  | "transport"
  | "education"
  | "healthcare"
  | "insurance"
  | "entertainment"
  | "shopping"
  | "family_support"
  | "other";

export interface ExpenseItem {
  id: string;
  category: ExpenseCategoryKey;
  name: string;
  amount: number;
  isFixed: boolean;
}

export type AssetCategoryKey =
  | "cash"
  | "savings"
  | "gold"
  | "stocks"
  | "funds"
  | "real_estate"
  | "crypto"
  | "other";

export interface AssetItem {
  id: string;
  category: AssetCategoryKey;
  name: string;
  balance: number;
  updatedAt: string;
  interestRate?: number;
  sourceNote?: string;
}

export type DebtCategoryKey =
  | "credit_card"
  | "mortgage"
  | "car_loan"
  | "consumer_loan"
  | "relative_loan"
  | "other";

export interface DebtItem {
  id: string;
  category: DebtCategoryKey;
  name: string;
  balance: number;
  interestRate: number;
  minMonthlyPayment: number;
  remainingMonths: number;
}

export type GoalPriority = "high" | "medium" | "low";
export type GoalStatus = "on_track" | "lagging" | "completed" | "paused";

export interface FinancialGoal {
  id: string;
  name: string;
  targetAmount: number;
  accumulatedAmount: number;
  deadline: string;
  priority: GoalPriority;
  status: GoalStatus;
  lagPercent?: number;
  requiredMonthlySavings?: number;
}

export interface AssumptionSet {
  inflationRate: number;
  salaryGrowthRate: number;
  returnsConservative: number;
  returnsBase: number;
  returnsAggressive: number;
  retirementAge: number;
  lifeExpectancy: number;
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
  savingsRate: number;
  fixedCostRatio: number;
  totalAssets: number;
  liquidAssets: number;
  investedAssets: number;
  totalDebt: number;
  netWorth: number;
  emergencyFundMonths: number;
  debtToIncomeRatio: number;
  healthScore: {
    total: number;
    cashflowScore: number;
    emergencyScore: number;
    debtScore: number;
    networthScore: number;
    disciplineScore: number;
    ratingText: string;
  };
}

export interface SixPartAdvice {
  finding: string;
  impact: string;
  action: string;
  amount: number;
  deadline: string;
  assumptionsAndConfidence: string;
}

export interface Insight {
  id: string;
  period: string;
  ruleCode: string;
  priorityOrder: number;
  severity: "critical" | "warning" | "info" | "positive";
  title: string;
  content: SixPartAdvice;
  status: "new" | "completed" | "dismissed";
}

export interface MonthlySnapshot {
  period: string;
  profile: FinanceProfile;
  income: IncomeEntry;
  expenses: ExpenseItem[];
  assets: AssetItem[];
  debts: DebtItem[];
  goals: FinancialGoal[];
  metrics: CalculatedMetrics;
  engineVersion: string;
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
