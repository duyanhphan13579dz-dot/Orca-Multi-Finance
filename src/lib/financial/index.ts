/** Financial Report Data Reliability Layer — public surface. */

export { getFinancialPackage, getFinancialsForSymbol } from "./service";
export { listFinancialProviders } from "./providers-registry";
export { runSourceRouter } from "./provider";
export type { FinancialProvider, RouterOutcome } from "./provider";
export { decideFallback, applyFallbackToMeta } from "./fallback";
export type { FallbackDecision, FallbackLevel } from "./fallback";
export { getFinancialSourceHealth } from "./source-health";
export { getFinancialMonitorSnapshot } from "./monitor";
export {
  scoreFinancialQuality,
  crossValidatePeriods,
  internalConsistencyValidate,
  runFullCrossValidation,
} from "./validation";
export { appendValidationLog, getValidationLogs, getValidationAnalytics } from "./validation-log";
export { getOfficialFilingsForSymbol, runOfficialDocumentPipeline } from "./official/pipeline";
export {
  normalizeIncomeMetrics,
  normalizeBalanceMetrics,
  normalizeCashflowMetrics,
  normalizePeriodMetrics,
  normalizePeriods,
  periodsToStatementTables,
} from "./statements";
export { buildTtmPeriod, computeGrowth, sortPeriodsNewestFirst } from "./normalize";
export { getIndustryProfile, listIndustryProfiles, profileIdFromSector } from "./industry-profiles";
export {
  METRIC_DICTIONARY,
  getMetricDef,
  labelForMetric,
  metricKeyFromItemCode,
  metricKeyFromAlias,
  metricProfileForSymbol,
  labeledMetricsForPeriod,
  orderedKeysForProfile,
  INCOME_METRIC_ORDER,
  BALANCE_METRIC_ORDER,
  CASHFLOW_METRIC_ORDER,
} from "./metric-dictionary";
export type { MetricKey, MetricDefinition, MetricProfile } from "./metric-dictionary";
export type * from "./types";
