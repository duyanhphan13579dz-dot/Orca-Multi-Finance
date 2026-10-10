import "server-only";

/**
 * ORCA Data Engine Hub
 *
 * - Catalog of all external sources
 * - Request-scoped singleflight so modules share one fetch
 * - Cross-check helpers without re-calling providers
 * - Source sync ranking + connection resilience
 */

export {
  runInDataHub,
  getHubStore,
  hubStats,
  createHubStore,
} from "./request-scope";

export { coalesce, hubPeek } from "./coalesce";

export {
  hubLoad,
  hubFinancialPackage,
  hubFinancialPackagePeek,
  hubVnQuotes,
  hubVnQuotesPeek,
  hubCryptoDetail,
  hubForexDetail,
  hubCommodityMarket,
  hubNews,
  hubMacro,
  hubCrossCheckNumbers,
  hubPrefetch,
  hubPortfolioMarks,
  HubKeys,
  SOURCE_CATALOG,
  catalogSummary,
  syncAllSources,
  getLastSync,
  routeForDomain,
} from "./hub";

export type { SourceDomain, SourceCatalogEntry } from "./catalog";
export { sourcesByDomain } from "./catalog";

export { firstHealthy, raceHealthy, gatherHealthy, withTimeout, rankSourceIds } from "./resilience";
export type { FallbackAttempt, FallbackResult } from "./resilience";
export type { SourceSyncReport, SyncProbe } from "./source-sync";

export {
  ASSET_TYPE_REGISTRY,
  listAssetTypes,
  normalizeAssetType,
  formatAssetTypeVi,
  groupByAssetType,
  isKnownAssetType,
} from "./asset-registry";
export type { HubAssetType, AssetTypeDef } from "./asset-registry";
export type { HubPortfolioMark } from "./hub";

export {
  runGuarded,
  guardedCall,
  tryAcquireSubrequest,
  recordSubrequests,
  isOverloaded,
  budgetLeftMs,
  getGuard,
  guardMeta,
  markIsolateOverload,
  isIsolateCoolingDown,
} from "./workers-guard";
export type { GuardState, GuardOpts } from "./workers-guard";

export { WORKERS_BUDGET, clampUniverse } from "./workers-budget";

export {
  validateSchemaContract,
  checkMonotonicTimestamps,
  assessDataFreshness,
  detectPriceAnomalies,
  evaluatePayloadQuality,
} from "./quality";
export type {
  QualitySeverity,
  QualityIssue,
  QualityGrade,
  SchemaContractResult,
  TimestampMonotonicityResult,
  FreshnessStatus,
  DataFreshnessResult,
  QuoteAnomaly,
  AnomalyDetectionResult,
  DataQualityReport,
} from "./quality";

export {
  reconcileNumericField,
  reconcileQuotes,
  reconcileFinancialMetrics,
} from "./reconcile";
export type {
  ReconcileStatus,
  OverallReconcileStatus,
  ReconcileSourceValue,
  ReconcileFieldResult,
  ReconciliationReport,
} from "./reconcile";

export {
  getVnDateTime,
  getMarketSession,
  getRecommendedPollInterval,
  shouldIngest,
} from "./scheduler";
export type {
  MarketSession,
  MarketSessionInfo,
} from "./scheduler";

export {
  recordSourceTelemetry,
  getSourceTelemetry,
  getAllSourcesTelemetry,
  resetTelemetryState,
} from "./telemetry";
export type {
  SourceCallRecord,
  SourceTelemetryStats,
} from "./telemetry";
