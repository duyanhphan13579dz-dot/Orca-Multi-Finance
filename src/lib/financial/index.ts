/**
 * Vietnam market + financial provider layout.
 *
 * - Market data (indices, board, quotes, OHLCV, universe): SSI Flashconnect primary,
 *   VNDirect fallback when SSI_API_KEY / SSI_API_SECRET (or SSI_FC_CONSUMER_*) is absent or unreachable.
 * - Financial statements (BCTC / analysis): VNDirect stays primary and only — SSI is never a
 *   financial provider here (see src/lib/financial/providers-registry.ts).
 */
import { ssiFcConfigured } from "../providers/ssi-fcdata";

export function vnProviderLayout() {
  const ssiLive = ssiFcConfigured();
  return {
    market: { primary: ssiLive ? "ssi-fcdata" : "vndirect", fallback: ssiLive ? "vndirect" : null },
    financial: { primary: "vndirect", fallback: null },
  } as const;
}

export { getFinancialPackage, getFinancialsForSymbol } from "./service";
export { listFinancialProviders } from "./providers-registry";
export { runSourceRouter } from "./provider";
export type { FinancialProvider, RouterOutcome } from "./provider";
export { decideFallback, applyFallbackToMeta } from "./fallback";
export type { FallbackDecision, FallbackLevel } from "./fallback";
export { getFinancialSourceHealth, getMarketSourceHealth } from "./source-health";
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
