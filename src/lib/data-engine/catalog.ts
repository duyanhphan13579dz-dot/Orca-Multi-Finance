import "server-only";

/**
 * Canonical catalog of ORCA external sources.
 * Used for health, routing docs, and hub key namespaces.
 *
 * Phase 3 — SLA freshness contracts added to every source entry:
 *   liveSlaMs:    data is considered LIVE (real-time) up to this age
 *   freshSlaMs:   data is considered FRESH up to this age
 *   staleSlaMs:   data becomes STALE beyond this age (alert-worthy)
 *   expectedSchema: field names the adapter must always provide (contract testing)
 */

export type SourceDomain =
  | "market"
  | "financial"
  | "crypto"
  | "forex"
  | "commodity"
  | "news"
  | "macro"
  | "rates"
  | "official";

export type SourceCatalogEntry = {
  id: string;
  domain: SourceDomain;
  role: "primary" | "fallback" | "secondary" | "enrichment";
  /** Module path under src/lib (documentation) */
  module: string;
  description: string;
  envHints?: string[];
  /** Soft per-call budget hint (ms) for hub resilience layer */
  timeoutMs?: number;
  /** Cross-request cache TTL hint (ms) — informational; cache.ts owns enforcement */
  ttlMs?: number;

  // Phase 3 — SLA freshness contracts
  /** Age (ms) within which data is considered LIVE. Default: 20_000 */
  liveSlaMs?: number;
  /** Age (ms) within which data is considered FRESH. Default: 120_000 */
  freshSlaMs?: number;
  /** Age (ms) beyond which data is considered STALE (alert-worthy). Default: 900_000 */
  staleSlaMs?: number;
  /** Expected field names in the response payload (contract testing). */
  expectedSchema?: string[];
};

export const SOURCE_CATALOG: SourceCatalogEntry[] = [
  {
    id: "vndirect",
    domain: "market",
    role: "primary",
    module: "providers/vndirect.ts",
    description: "VN market quotes, OHLCV, universe (DStock)",
    timeoutMs: 3500,
    ttlMs: 15_000,
    liveSlaMs: 15_000,
    freshSlaMs: 60_000,
    staleSlaMs: 300_000,
    expectedSchema: ["quotes", "meta"],
  },
  {
    id: "ssi-fcdata",
    domain: "market",
    role: "fallback",
    module: "providers/ssi-fcdata.ts",
    description: "SSI FastConnect market fallback",
    envHints: ["SSI_API_KEY", "SSI_API_SECRET"],
    timeoutMs: 3500,
    ttlMs: 15_000,
    liveSlaMs: 15_000,
    freshSlaMs: 60_000,
    staleSlaMs: 300_000,
    expectedSchema: ["quotes"],
  },
  {
    id: "ssi-iboard",
    domain: "market",
    role: "secondary",
    module: "providers/ssi-iboard.ts",
    description: "SSI iBoard board / secondary feed",
    liveSlaMs: 30_000,
    freshSlaMs: 120_000,
    staleSlaMs: 600_000,
  },
  {
    id: "vps",
    domain: "market",
    role: "secondary",
    module: "providers/vps.ts",
    description: "VPS market feed",
    liveSlaMs: 10_000,
    freshSlaMs: 30_000,
    staleSlaMs: 300_000,
  },
  {
    id: "vietcap",
    domain: "market",
    role: "secondary",
    module: "providers/vietcap.ts",
    description: "Vietcap market / research endpoints",
    liveSlaMs: 60_000,
    freshSlaMs: 300_000,
    staleSlaMs: 1_800_000,
  },
  {
    id: "public-vn-feed",
    domain: "market",
    role: "enrichment",
    module: "providers/public-vn-feed.ts",
    description: "Public VN board enrichment",
    freshSlaMs: 300_000,
    staleSlaMs: 1_800_000,
  },
  {
    id: "vndirect-fs",
    domain: "financial",
    role: "primary",
    module: "financial/vndirect-fs.ts",
    description: "BCTC / financial statements PRIMARY",
    freshSlaMs: 24 * 3600_000,     // financial statements are daily
    staleSlaMs: 7 * 24 * 3600_000, // stale after 7 days
    expectedSchema: ["periods", "source"],
  },
  {
    id: "vnstock",
    domain: "financial",
    role: "enrichment",
    module: "providers/vnstock.ts",
    description: "VNStock enrichment metrics",
    freshSlaMs: 6 * 3600_000,
    staleSlaMs: 48 * 3600_000,
  },
  {
    id: "vndirect-company",
    domain: "financial",
    role: "enrichment",
    module: "providers/vndirect-company.ts",
    description: "Company profile enrichment",
    freshSlaMs: 24 * 3600_000,
    staleSlaMs: 7 * 24 * 3600_000,
  },
  {
    id: "vndirect-events",
    domain: "financial",
    role: "enrichment",
    module: "providers/vndirect-events.ts",
    description: "Corporate events / dividends (DStock /v4/events)",
    timeoutMs: 10_000,
    ttlMs: 30 * 60_000,
    freshSlaMs: 3 * 3600_000,
    staleSlaMs: 24 * 3600_000,
    expectedSchema: ["events"],
  },
  {
    id: "ssc-official",
    domain: "official",
    role: "primary",
    module: "financial/official/*",
    description: "SSC / official document pipeline",
    freshSlaMs: 24 * 3600_000,
    staleSlaMs: 30 * 24 * 3600_000,
  },
  {
    id: "binance",
    domain: "crypto",
    role: "primary",
    module: "providers/binance.ts + realtime/binance-ws.ts",
    description: "Crypto spot / klines",
    timeoutMs: 3000,
    ttlMs: 10_000,
    liveSlaMs: 10_000,
    freshSlaMs: 30_000,
    staleSlaMs: 120_000,
    expectedSchema: ["symbol", "price"],
  },
  {
    id: "coingecko",
    domain: "crypto",
    role: "fallback",
    module: "providers/coingecko.ts",
    description: "Crypto metadata / fallback prices",
    liveSlaMs: 60_000,
    freshSlaMs: 300_000,
    staleSlaMs: 1_800_000,
  },
  {
    id: "okx-public",
    domain: "crypto",
    role: "fallback",
    module: "providers/crypto-public.ts",
    description: "OKX public spot tickers",
    timeoutMs: 7000,
    ttlMs: 15_000,
    liveSlaMs: 15_000,
    freshSlaMs: 60_000,
    staleSlaMs: 300_000,
  },
  {
    id: "coincap",
    domain: "crypto",
    role: "fallback",
    module: "providers/crypto-public.ts",
    description: "CoinCap top assets",
    timeoutMs: 6000,
    ttlMs: 30_000,
    liveSlaMs: 30_000,
    freshSlaMs: 120_000,
    staleSlaMs: 600_000,
  },
  {
    id: "forex-feed",
    domain: "forex",
    role: "primary",
    module: "providers/forex.ts",
    description: "FX pairs",
    timeoutMs: 3000,
    ttlMs: 30_000,
    liveSlaMs: 30_000,
    freshSlaMs: 120_000,
    staleSlaMs: 600_000,
    expectedSchema: ["rows"],
  },
  {
    id: "yahoo",
    domain: "forex",
    role: "fallback",
    module: "providers/yahoo.ts",
    description: "Yahoo fallback for global symbols",
    freshSlaMs: 300_000,
    staleSlaMs: 1_800_000,
  },
  {
    id: "commodities",
    domain: "commodity",
    role: "primary",
    module: "providers/commodities.ts",
    description: "Gold oil softs",
    timeoutMs: 4000,
    ttlMs: 60_000,
    freshSlaMs: 5 * 60_000,
    staleSlaMs: 30 * 60_000,
    expectedSchema: ["rows"],
  },
  {
    id: "cafef",
    domain: "news",
    role: "primary",
    module: "providers/cafef.ts",
    description: "CafeF news",
    freshSlaMs: 15 * 60_000,
    staleSlaMs: 60 * 60_000,
  },
  {
    id: "news-bundle",
    domain: "news",
    role: "primary",
    module: "providers/news.ts",
    description: "Aggregated news providers",
    freshSlaMs: 15 * 60_000,
    staleSlaMs: 60 * 60_000,
    expectedSchema: ["articles"],
  },
  {
    id: "vietnambiz-economy",
    domain: "macro",
    role: "primary",
    module: "providers/vietnambiz-economy.ts",
    description: "Macro / economy articles",
    freshSlaMs: 60 * 60_000,
    staleSlaMs: 6 * 3600_000,
  },
  {
    id: "economic-data",
    domain: "macro",
    role: "primary",
    module: "economic-data.ts",
    description: "Structured macro series",
    freshSlaMs: 24 * 3600_000,
    staleSlaMs: 7 * 24 * 3600_000,
  },
  {
    id: "worldbank",
    domain: "macro",
    role: "secondary",
    module: "providers/worldbank.ts",
    description: "World Bank structured annual macro (VN-first, no API key)",
    timeoutMs: 10_000,
    ttlMs: 6 * 60 * 60_000,
    freshSlaMs: 24 * 3600_000,
    staleSlaMs: 90 * 24 * 3600_000, // annual data — stale after 90 days
  },
];

export function sourcesByDomain(domain: SourceDomain): SourceCatalogEntry[] {
  return SOURCE_CATALOG.filter((s) => s.domain === domain);
}

export function catalogSummary() {
  const byDomain: Record<string, number> = {};
  for (const s of SOURCE_CATALOG) {
    byDomain[s.domain] = (byDomain[s.domain] ?? 0) + 1;
  }
  return { total: SOURCE_CATALOG.length, byDomain, sources: SOURCE_CATALOG };
}

/**
 * Phase 3 — Returns the effective freshness SLA thresholds for a source,
 * falling back to platform defaults when not specified.
 */
export function getSourceSla(sourceId: string): { liveSlaMs: number; freshSlaMs: number; staleSlaMs: number } {
  const entry = SOURCE_CATALOG.find((s) => s.id === sourceId);
  return {
    liveSlaMs: entry?.liveSlaMs ?? 20_000,
    freshSlaMs: entry?.freshSlaMs ?? 120_000,
    staleSlaMs: entry?.staleSlaMs ?? 900_000,
  };
}
