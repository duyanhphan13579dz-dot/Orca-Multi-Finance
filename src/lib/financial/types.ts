/**
 * Financial Report Data Engine — shared types.
 * EXTEND-only layer: does not replace existing stocks/intelligence contracts.
 */

export type PeriodType = "quarter" | "semi" | "year" | "ttm" | "month";
export type StatementScope = "consolidated" | "standalone" | "unknown";
export type AuditStatus = "audited" | "reviewed" | "unaudited" | "unknown";
export type FreshnessStatus =
  | "VERIFIED"
  | "LATEST_AVAILABLE"
  | "STALE"
  | "UNVERIFIED"
  | "DISCREPANCY_DETECTED"
  | "SOURCE_UNAVAILABLE";

export type SourceRole = "PRIMARY_SOURCE_OF_TRUTH" | "FAST_STRUCTURED_DATA_SOURCE" | "SECONDARY_FALLBACK" | "CACHE";

export interface FinancialSourceMeta {
  id: string;
  role: SourceRole;
  priority: number;
  success: boolean;
  latencyMs?: number;
  note?: string;
}

/** Normalized period row — keys are stable English metric names. */
export type NormalizedMetrics = Partial<{
  revenue: number;
  netRevenue: number;
  cogs: number;
  grossProfit: number;
  operatingProfit: number;
  ebit: number;
  ebitda: number;
  interestExpense: number;
  profitBeforeTax: number;
  taxExpense: number;
  netIncome: number;
  netIncomeParent: number;

  cash: number;
  shortTermInvestments: number;
  receivables: number;
  inventory: number;
  currentAssets: number;
  fixedAssets: number;
  longTermAssets: number;
  totalAssets: number;

  shortTermDebt: number;
  longTermDebt: number;
  currentLiabilities: number;
  totalLiabilities: number;
  equity: number;
  retainedEarnings: number;

  operatingCashFlow: number;
  investingCashFlow: number;
  financingCashFlow: number;
  capex: number;
  freeCashFlow: number;
  cashBegin: number;
  cashEnd: number;
}>;

export interface NormalizedPeriod {
  period: string;
  periodType: PeriodType;
  fiscalDate: string | null;
  year: number | null;
  quarter: number | null;
  statementScope: StatementScope;
  auditStatus: AuditStatus;
  currency: "VND";
  source: string;
  sourceUrl?: string;
  filingDate?: string | null;
  confidence: number;
  metrics: NormalizedMetrics;
}

export interface FinancialPackageMeta {
  ticker: string;
  latestPeriod: string | null;
  reportTypeLabel: string;
  statementScope: StatementScope;
  auditStatus: AuditStatus;
  primarySource: string;
  sourcesAttempted: FinancialSourceMeta[];
  fallbackLevel: 0 | 1 | 2 | 3 | 4;
  freshnessStatus: FreshnessStatus;
  fetchedAt: string;
  lastVerifiedAt: string | null;
  note: string | null;
  ttmPeriod: string | null;
  hasGrowth: boolean;
}

/** Growth payload is produced by normalize.ts — kept structural here for consumers. */
export interface GrowthCell {
  metric: string;
  current: number | null;
  prior: number | null;
  changePct: number | null;
  currentPeriod: string | null;
  priorPeriod: string | null;
}

export interface GrowthSnapshot {
  yoy: GrowthCell[];
  qoq: GrowthCell[];
  latestPeriod: string | null;
  priorYearPeriod: string | null;
  priorQuarterPeriod: string | null;
}

export interface FinancialPackage {
  symbol: string;
  income: Record<string, unknown>[];
  balance: Record<string, unknown>[];
  cashflow: Record<string, unknown>[];
  ratios: Record<string, unknown>[];
  periods: NormalizedPeriod[];
  ttm: NormalizedPeriod | null;
  growth: GrowthSnapshot | null;
  meta: FinancialPackageMeta;
}
