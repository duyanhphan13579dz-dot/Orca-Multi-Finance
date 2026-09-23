import "server-only";

/**
 * ORCA Data Engine Hub
 *
 * - Catalog of all external sources
 * - Request-scoped singleflight so modules share one fetch
 * - Cross-check helpers without re-calling providers
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
  HubKeys,
  SOURCE_CATALOG,
  catalogSummary,
} from "./hub";

export type { SourceDomain, SourceCatalogEntry } from "./catalog";
export { sourcesByDomain } from "./catalog";
