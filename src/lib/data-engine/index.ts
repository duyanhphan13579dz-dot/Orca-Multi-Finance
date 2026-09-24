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
  HubKeys,
  SOURCE_CATALOG,
  catalogSummary,
  syncAllSources,
  getLastSync,
  routeForDomain,
} from "./hub";

export type { SourceDomain, SourceCatalogEntry } from "./catalog";
export { sourcesByDomain } from "./catalog";

export { firstHealthy, withTimeout, rankSourceIds } from "./resilience";
export type { SourceSyncReport, SyncProbe } from "./source-sync";
