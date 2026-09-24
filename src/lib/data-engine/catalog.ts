import "server-only";

/**
 * Canonical catalog of ORCA external sources.
 * Used for health, routing docs, and hub key namespaces.
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
};

export const SOURCE_CATALOG: SourceCatalogEntry[] = [
  // Market VN
  {
    id: "vndirect",
    domain: "market",
    role: "primary",
    module: "providers/vndirect.ts",
    description: "VN market quotes, OHLCV, universe (DStock)",
  },
  {
    id: "ssi-fcdata",
    domain: "market",
    role: "fallback",
    module: "providers/ssi-fcdata.ts",
    description: "SSI FastConnect market fallback",
    envHints: ["SSI_API_KEY", "SSI_API_SECRET"],
  },
  {
    id: "ssi-iboard",
    domain: "market",
    role: "secondary",
    module: "providers/ssi-iboard.ts",
    description: "SSI iBoard board / secondary feed",
  },
  {
    id: "vps",
    domain: "market",
    role: "secondary",
    module: "providers/vps.ts",
    description: "VPS market feed",
  },
  {
    id: "vietcap",
    domain: "market",
    role: "secondary",
    module: "providers/vietcap.ts",
    description: "Vietcap market / research endpoints",
  },
  {
    id: "public-vn-feed",
    domain: "market",
    role: "enrichment",
    module: "providers/public-vn-feed.ts",
    description: "Public VN board enrichment",
  },
  // Financial statements
  {
    id: "vndirect-fs",
    domain: "financial",
    role: "primary",
    module: "financial/vndirect-fs.ts",
    description: "BCTC / financial statements PRIMARY",
  },
  {
    id: "vnstock",
    domain: "financial",
    role: "enrichment",
    module: "providers/vnstock.ts",
    description: "VNStock enrichment metrics",
  },
  {
    id: "vndirect-company",
    domain: "financial",
    role: "enrichment",
    module: "providers/vndirect-company.ts",
    description: "Company profile enrichment",
  },
  // Official filings
  {
    id: "ssc-official",
    domain: "official",
    role: "primary",
    module: "financial/official/*",
    description: "SSC / official document pipeline",
  },
  // Crypto
  {
    id: "binance",
    domain: "crypto",
    role: "primary",
    module: "providers/binance.ts + realtime/binance-ws.ts",
    description: "Crypto spot / klines",
  },
  {
    id: "coingecko",
    domain: "crypto",
    role: "fallback",
    module: "providers/coingecko.ts",
    description: "Crypto metadata / fallback prices",
  },
  // Forex / FX
  {
    id: "forex-feed",
    domain: "forex",
    role: "primary",
    module: "providers/forex.ts",
    description: "FX pairs",
  },
  {
    id: "yahoo",
    domain: "forex",
    role: "fallback",
    module: "providers/yahoo.ts",
    description: "Yahoo fallback for global symbols",
  },
  // Commodity
  {
    id: "commodities",
    domain: "commodity",
    role: "primary",
    module: "providers/commodities.ts",
    description: "Gold oil softs",
  },
  // News / macro
  {
    id: "cafef",
    domain: "news",
    role: "primary",
    module: "providers/cafef.ts",
    description: "CafeF news",
  },
  {
    id: "news-bundle",
    domain: "news",
    role: "primary",
    module: "providers/news.ts",
    description: "Aggregated news providers",
  },
  {
    id: "vietnambiz-economy",
    domain: "macro",
    role: "primary",
    module: "providers/vietnambiz-economy.ts",
    description: "Macro / economy articles",
  },
  {
    id: "economic-data",
    domain: "macro",
    role: "primary",
    module: "economic-data.ts",
    description: "Structured macro series",
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
