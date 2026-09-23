import "server-only";

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
  module: string;
  description: string;
  envHints?: string[];
};

export const SOURCE_CATALOG: SourceCatalogEntry[] = [
  { id: "vndirect", domain: "market", role: "primary", module: "providers/vndirect.ts", description: "VN market quotes, OHLCV, universe" },
  { id: "ssi-fcdata", domain: "market", role: "fallback", module: "providers/ssi-fcdata.ts", description: "SSI FastConnect market fallback", envHints: ["SSI_API_KEY", "SSI_API_SECRET"] },
  { id: "ssi-iboard", domain: "market", role: "secondary", module: "providers/ssi-iboard.ts", description: "SSI iBoard secondary" },
  { id: "vps", domain: "market", role: "secondary", module: "providers/vps.ts", description: "VPS market feed" },
  { id: "vietcap", domain: "market", role: "secondary", module: "providers/vietcap.ts", description: "Vietcap market" },
  { id: "public-vn-feed", domain: "market", role: "enrichment", module: "providers/public-vn-feed.ts", description: "Public VN enrichment" },
  { id: "vndirect-fs", domain: "financial", role: "primary", module: "financial/vndirect-fs.ts", description: "BCTC PRIMARY" },
  { id: "vnstock", domain: "financial", role: "enrichment", module: "providers/vnstock.ts", description: "VNStock enrichment" },
  { id: "vndirect-company", domain: "financial", role: "enrichment", module: "providers/vndirect-company.ts", description: "Company profile" },
  { id: "ssc-official", domain: "official", role: "primary", module: "financial/official/*", description: "SSC official filings" },
  { id: "binance", domain: "crypto", role: "primary", module: "providers/binance.ts", description: "Crypto spot" },
  { id: "coingecko", domain: "crypto", role: "fallback", module: "providers/coingecko.ts", description: "Crypto fallback" },
  { id: "forex-feed", domain: "forex", role: "primary", module: "providers/forex.ts", description: "FX pairs" },
  { id: "yahoo", domain: "forex", role: "fallback", module: "providers/yahoo.ts", description: "Yahoo fallback" },
  { id: "commodities", domain: "commodity", role: "primary", module: "providers/commodities.ts", description: "Commodities" },
  { id: "cafef", domain: "news", role: "primary", module: "providers/cafef.ts", description: "CafeF news" },
  { id: "news-bundle", domain: "news", role: "primary", module: "providers/news.ts", description: "News aggregate" },
  { id: "vietnambiz-economy", domain: "macro", role: "primary", module: "providers/vietnambiz-economy.ts", description: "Macro articles" },
  { id: "economic-data", domain: "macro", role: "primary", module: "economic-data.ts", description: "Macro series" },
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
