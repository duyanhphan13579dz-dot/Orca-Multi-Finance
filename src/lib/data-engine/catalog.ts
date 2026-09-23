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
    description: "SSI iBoard secondary quotes",
  },
  {
    id: "tcbs",
    domain: "market",
    role: "secondary",
    module: "providers/tcbs.ts",
    description: "TCBS market quotes",
  },
  {
    id: "cafef",
    domain: "market",
    role: "enrichment",
    module: "providers/cafef.ts",
    description: "CafeF quotes + news",
  },
  // Financial package
  {
    id: "vndirect-fs",
    domain: "financial",
    role: "primary",
    module: "providers/vndirect.ts",
    description: "VNDIRECT financial statements (income/balance/cashflow)",
  },
  {
    id: "ssi-fs",
    domain: "financial",
    role: "fallback",
    module: "providers/ssi.ts",
    description: "SSI financials fallback",
  },
  {
    id: "cafef-fs",
    domain: "financial",
    role: "secondary",
    module: "providers/cafef.ts",
    description: "CafeF financials",
  },
  {
    id: "fireant",
    domain: "financial",
    role: "enrichment",
    module: "providers/fireant.ts",
    description: "FireAnt fundamentals / screener",
  },
  // Crypto
  {
    id: "binance",
    domain: "crypto",
    role: "primary",
    module: "providers/binance.ts",
    description: "Binance spot tickers",
  },
  {
    id: "coingecko",
    domain: "crypto",
    role: "fallback",
    module: "providers/coingecko.ts",
    description: "CoinGecko market data",
  },
  // Forex
  {
    id: "forex-feed",
    domain: "forex",
    role: "primary",
    module: "providers/forex.ts",
    description: "FX pair rates",
  },
  // Commodity
  {
    id: "commodities",
    domain: "commodity",
    role: "primary",
    module: "providers/commodities.ts",
    description: "VietnamBiz goods / commodities",
  },
  // News
  {
    id: "news-bundle",
    domain: "news",
    role: "primary",
    module: "providers/news.ts",
    description: "Aggregated RSS news bundle",
  },
  // Macro
  {
    id: "economic-data",
    domain: "macro",
    role: "primary",
    module: "economic-data.ts",
    description: "Macro / economic series",
  },
  {
    id: "fred",
    domain: "macro",
    role: "secondary",
    module: "providers/fred.ts",
    description: "FRED series",
  },
  // Rates / official
  {
    id: "sbv",
    domain: "rates",
    role: "primary",
    module: "providers/sbv.ts",
    description: "State Bank of Vietnam rates",
  },
  {
    id: "official-stats",
    domain: "official",
    role: "primary",
    module: "providers/official.ts",
    description: "Official statistics feeds",
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
  return {
    total: SOURCE_CATALOG.length,
    byDomain,
    sources: SOURCE_CATALOG.map((s) => ({
      id: s.id,
      domain: s.domain,
      role: s.role,
      module: s.module,
    })),
  };
}
