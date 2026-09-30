import "server-only";

export type PublicSourceDomain = "vn-stocks" | "macro" | "crypto" | "forex" | "commodities" | "news";
export type PublicSourceCadence = "realtime" | "daily" | "intraday";

export interface PublicSourceDefinition {
  id: string;
  name: string;
  domain: PublicSourceDomain;
  access: "open" | "free-tier";
  cadence: PublicSourceCadence;
  url: string;
  apiKeyRequired: boolean;
  notes: string;
}

/** Curated public/free sources used as adapters or research candidates. */
export const PUBLIC_SOURCE_CATALOG: PublicSourceDefinition[] = [
  { id: "vps-bgapidatafeed", name: "VPS Fmarket/BGAPi", domain: "vn-stocks", access: "open", cadence: "realtime", url: "https://bgapidatafeed.vps.com.vn", apiKeyRequired: false, notes: "Vietnamese quotes and board fallback." },
  { id: "ssi-iboard", name: "SSI iBoard", domain: "vn-stocks", access: "open", cadence: "realtime", url: "https://iboard.ssi.com.vn", apiKeyRequired: false, notes: "Public quote and index fallback." },
  { id: "yahoo-finance", name: "Yahoo Finance", domain: "macro", access: "open", cadence: "intraday", url: "https://finance.yahoo.com", apiKeyRequired: false, notes: "Indices and cross-market reference quotes." },
  { id: "binance-public", name: "Binance public market data", domain: "crypto", access: "open", cadence: "realtime", url: "https://api.binance.com/api/v3", apiKeyRequired: false, notes: "Spot ticker and klines; geo-aware failover." },
  { id: "coingecko-demo", name: "CoinGecko Demo API", domain: "crypto", access: "free-tier", cadence: "intraday", url: "https://api.coingecko.com/api/v3", apiKeyRequired: false, notes: "Secondary crypto market reference." },
  { id: "frankfurter-ecb", name: "Frankfurter / ECB", domain: "forex", access: "open", cadence: "daily", url: "https://api.frankfurter.dev", apiKeyRequired: false, notes: "Official ECB reference history, not intraday pricing." },
  { id: "exchange-rate-api", name: "ExchangeRate API open", domain: "forex", access: "open", cadence: "daily", url: "https://open.er-api.com/v6", apiKeyRequired: false, notes: "USD-based latest rates with provider timestamp." },
  { id: "vietnambiz-data", name: "VietnamBiz Data", domain: "commodities", access: "open", cadence: "daily", url: "https://data.vietnambiz.vn/goods", apiKeyRequired: false, notes: "Vietnam commodity board and local reference prices." },
  { id: "fred-public", name: "Federal Reserve FRED", domain: "macro", access: "open", cadence: "daily", url: "https://fred.stlouisfed.org", apiKeyRequired: false, notes: "Public macro series; adapter can use CSV download endpoints." },
  { id: "sbv-public", name: "State Bank of Vietnam", domain: "macro", access: "open", cadence: "daily", url: "https://www.sbv.gov.vn", apiKeyRequired: false, notes: "Official Vietnamese monetary and exchange-rate publications." },
];

export function listPublicSources(domain?: PublicSourceDomain): PublicSourceDefinition[] {
  return domain ? PUBLIC_SOURCE_CATALOG.filter((source) => source.domain === domain) : PUBLIC_SOURCE_CATALOG;
}

export function getPublicSource(id: string): PublicSourceDefinition | undefined {
  return PUBLIC_SOURCE_CATALOG.find((source) => source.id === id);
}
