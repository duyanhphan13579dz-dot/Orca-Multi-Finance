import "server-only";

/**
 * Canonical catalog of ORCA external sources.
 * Used for health, routing docs, hub key namespaces and the connectivity self-test.
 *
 * `id` matches the provider id used at runtime (`httpJson({ provider })`, `recordSuccess`,
 * `/system/providers`), so catalog rows and health rows line up 1:1.
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

export type SourceRole = "primary" | "fallback" | "secondary" | "enrichment";

export type SourceCatalogEntry = {
  id: string;
  domain: SourceDomain;
  role: SourceRole;
  /** Module path under src/lib (documentation) */
  module: string;
  description: string;
  envHints?: string[];
  /** Soft per-call budget hint (ms) for hub resilience layer */
  timeoutMs?: number;
  /** Cross-request cache TTL hint (ms) — informational; cache.ts owns enforcement */
  ttlMs?: number;
  /** Optional natural key to probe in the connectivity self-test (see source-sync.ts) */
  probeKey?: string;
};

export const SOURCE_CATALOG: SourceCatalogEntry[] = [
  // ── Vietnam equities: quotes, board, OHLCV, universe ─────────────────────────
  {
    id: "vndirect",
    domain: "market",
    role: "primary",
    module: "providers/vndirect.ts + providers/vndirect-market-quotes.ts",
    description:
      "VNDirect DStock/api-finfo — quotes, whole-board snapshot, indices, OHLCV, foreign/ETF flow, universe",
    envHints: ["VNDIRECT_BASE_URL", "VNDIRECT_FALLBACK_BASE_URLS"],
    timeoutMs: 3800,
    ttlMs: 15_000,
    probeKey: "vndirect",
  },
  {
    id: "vndirect-dchart",
    domain: "market",
    role: "secondary",
    module: "providers/vndirect-dchart.ts",
    description: "VNDirect dchart intraday OHLCV (multi-resolution)",
    timeoutMs: 4500,
    probeKey: "vndirect-dchart",
  },
  {
    id: "ssi-fcdata",
    domain: "market",
    role: "fallback",
    module: "providers/ssi-fcdata.ts + providers/ssi-market-catalog.ts",
    description: "SSI FastConnect — quotes/board/OHLCV/index history (needs credentials)",
    envHints: ["SSI_FC_CONSUMER_ID", "SSI_FC_CONSUMER_SECRET"],
    timeoutMs: 4500,
    ttlMs: 15_000,
    probeKey: "ssi-fcdata",
  },
  {
    id: "ssi-iboard",
    domain: "market",
    role: "secondary",
    module: "providers/ssi-iboard.ts",
    description: "SSI iBoard public board — quotes + full HOSE/HNX/UPCoM universe",
    timeoutMs: 4000,
    ttlMs: 15_000,
    probeKey: "ssi-iboard",
  },
  {
    id: "vps",
    domain: "market",
    role: "secondary",
    module: "providers/vps.ts",
    description: "VPS bgapidatafeed getliststockdata board feed",
    timeoutMs: 4000,
    probeKey: "vps",
  },
  {
    id: "entrade",
    domain: "market",
    role: "fallback",
    module: "providers/public-vn-feed.ts",
    description: "Entrade chart-api daily OHLCV (stock + index)",
    timeoutMs: 6000,
    probeKey: "entrade",
  },
  {
    id: "vps-hist",
    domain: "market",
    role: "fallback",
    module: "providers/public-vn-feed.ts",
    description: "VPS TradingView history — daily OHLCV fallback",
    timeoutMs: 6000,
    probeKey: "vps-hist",
  },
  {
    id: "vietcap",
    domain: "market",
    role: "secondary",
    module: "providers/vietcap.ts",
    description: "Vietcap IQ Insight — company profile + current price",
    timeoutMs: 4000,
    probeKey: "vietcap",
  },
  {
    id: "public-vn",
    domain: "market",
    role: "enrichment",
    module: "providers/public-vn-feed.ts",
    description: "Aggregated public VN merge layer (VPS ∥ SSI iBoard ∥ Vietcap ∥ Yahoo)",
    ttlMs: 15_000,
  },
  {
    id: "yahoo-vn",
    domain: "market",
    role: "fallback",
    module: "providers/yahoo.ts",
    description: "Yahoo Finance VN fallback — .VN tickers and ^VNINDEX/^VN30/^HNX/^UPCOM",
    timeoutMs: 6000,
    probeKey: "yahoo-vn",
  },
  {
    id: "polygon",
    domain: "market",
    role: "enrichment",
    module: "providers/polygon.ts",
    description: "US equity/ETF snapshots for the global pulse (needs key)",
    envHints: ["POLYGON_API_KEY", "POLYGON_API_BASE_URL"],
    timeoutMs: 8000,
    probeKey: "polygon",
  },

  // ── Vietnam financial statements / company data ──────────────────────────────
  {
    id: "vndirect-fs",
    domain: "financial",
    role: "primary",
    module: "financial/vndirect-fs.ts + financial/vndirect-http.ts",
    description: "BCTC / financial statements PRIMARY (DStock api-finfo, host failover)",
    envHints: ["VNDIRECT_BASE_URL", "VNDIRECT_FALLBACK_BASE_URLS"],
    timeoutMs: 7000,
    probeKey: "vndirect-fs",
  },
  {
    id: "vnstock-financial",
    domain: "financial",
    role: "fallback",
    module: "financial/vnstock-provider.ts + providers/vnstock.ts",
    description: "VNStock API BCTC fallback — enabled only with base URL + key",
    envHints: ["VNSTOCK_BASE_URL", "VNSTOCK_API_KEY"],
    timeoutMs: 7000,
    probeKey: "vnstock",
  },
  {
    id: "vndirect-company",
    domain: "financial",
    role: "enrichment",
    module: "providers/vndirect-company.ts",
    description: "Company profile, equity snapshot, ratios (DStock)",
    timeoutMs: 4000,
    probeKey: "vndirect-company",
  },
  {
    id: "ssc-official",
    domain: "official",
    role: "primary",
    module: "financial/official/*",
    description: "SSC / official filing pipeline (listing index, calendar)",
  },
  {
    id: "google-sheets",
    domain: "official",
    role: "enrichment",
    module: "providers/google-sheets.ts",
    description: "Google Sheets bridge for user-maintained datasets",
    envHints: ["GOOGLE_SHEETS_ID"],
  },

  // ── Crypto ──────────────────────────────────────────────────────────────────
  {
    id: "binance-spot",
    domain: "crypto",
    role: "primary",
    module: "providers/binance.ts + realtime/binance-ws.ts",
    description: "Crypto spot tickers/klines + WS streams",
    envHints: ["BINANCE_BASE_URL", "BINANCE_WS_DISABLED"],
    timeoutMs: 3000,
    ttlMs: 10_000,
    probeKey: "binance-spot",
  },
  {
    id: "binance-futures",
    domain: "crypto",
    role: "secondary",
    module: "providers/binance.ts",
    description: "Funding / open interest (geo-dependent)",
    envHints: ["BINANCE_FAPI_BASE_URL"],
    timeoutMs: 6000,
    probeKey: "binance-futures",
  },
  {
    id: "coingecko",
    domain: "crypto",
    role: "fallback",
    module: "providers/coingecko.ts",
    description: "Crypto metadata / fallback prices (public or Pro key)",
    envHints: ["COINGECKO_BASE_URL", "COINGECKO_PRO_API_KEY"],
    timeoutMs: 8000,
    probeKey: "coingecko",
  },

  // ── Forex ───────────────────────────────────────────────────────────────────
  {
    id: "biquote-forex",
    domain: "forex",
    role: "primary",
    module: "providers/forex.ts",
    description: "Biquote FX quotes (configured base URL)",
    envHints: ["BIQUOTE_BASE_URL", "BIQUOTE_API_KEY"],
    timeoutMs: 5000,
    probeKey: "biquote-forex",
  },
  {
    id: "biquote-public",
    domain: "forex",
    role: "secondary",
    module: "providers/forex.ts",
    description: "Biquote public FX OHLC series",
    timeoutMs: 5000,
    probeKey: "biquote-public",
  },
  {
    id: "exchangerate-api",
    domain: "forex",
    role: "fallback",
    module: "providers/forex.ts",
    description: "exchangerate-api open latest (USD-based crosses)",
    timeoutMs: 5000,
    probeKey: "exchangerate-api",
  },
  {
    id: "frankfurter-ecb",
    domain: "forex",
    role: "fallback",
    module: "providers/forex.ts",
    description: "Frankfurter / ECB daily reference history + previous fix",
    timeoutMs: 5000,
    probeKey: "frankfurter-ecb",
  },
  {
    id: "yahoo",
    domain: "forex",
    role: "fallback",
    module: "providers/yahoo.ts",
    description: "Yahoo chart/quote fallback for global symbols, FX and crypto",
    timeoutMs: 6000,
    probeKey: "yahoo",
  },

  // ── Commodities ─────────────────────────────────────────────────────────────
  {
    id: "vietnambiz-data",
    domain: "commodity",
    role: "primary",
    module: "providers/commodities.ts",
    description: "Vietnambiz goods catalog (SJC gold, metals, energy, softs)",
    envHints: ["VIETNAMBIZ_BASE_URL"],
    timeoutMs: 8000,
    ttlMs: 60_000,
    probeKey: "vietnambiz-data",
  },
  {
    id: "simplize",
    domain: "commodity",
    role: "fallback",
    module: "providers/commodities.ts",
    description: "Simplize commodity quotes",
    envHints: ["SIMPLIZE_API_KEY", "SIMPLIZE_BASE_URL"],
    timeoutMs: 6000,
    probeKey: "simplize",
  },
  {
    id: "msn-finance",
    domain: "commodity",
    role: "fallback",
    module: "providers/commodities.ts",
    description: "MSN Finance quotes (env instrument map)",
    timeoutMs: 8000,
    probeKey: "msn-finance",
  },

  // ── News / macro ────────────────────────────────────────────────────────────
  {
    id: "cafef",
    domain: "news",
    role: "primary",
    module: "providers/cafef.ts",
    description: "CafeF news + proprietary flow widgets",
    probeKey: "cafef",
  },
  {
    id: "rss-news",
    domain: "news",
    role: "primary",
    module: "providers/news.ts",
    description: "Aggregated RSS feeds (VnExpress, VietnamBiz, Tuổi Trẻ, BBC, CoinTelegraph, Google News)",
    probeKey: "rss-news",
  },
  {
    id: "vietnambiz-economy",
    domain: "macro",
    role: "primary",
    module: "providers/vietnambiz-economy.ts",
    description: "Macro / economy articles",
    probeKey: "vietnambiz-economy",
  },
  {
    id: "economic-data",
    domain: "macro",
    role: "primary",
    module: "economic-data.ts",
    description: "Structured macro series (rates, CPI, GDP, FX reserves…)",
  },

  // ── Rates / derivatives ─────────────────────────────────────────────────────
  {
    id: "hnx-derivatives",
    domain: "rates",
    role: "primary",
    module: "providers/hnx-derivatives.ts",
    description: "HNX derivatives quotes / contract specs",
    envHints: ["DERIVATIVES_QUOTE_URL", "DERIVATIVES_QUOTE_API_KEY"],
    probeKey: "hnx-derivatives",
  },
  {
    id: "vsdc-spec",
    domain: "rates",
    role: "secondary",
    module: "providers/vsdc-spec.ts + providers/vsdc-margin.ts",
    description: "VSDC derivative contract specs and margin ratios",
  },
];

export function sourcesByDomain(domain: SourceDomain): SourceCatalogEntry[] {
  return SOURCE_CATALOG.filter((s) => s.domain === domain);
}

export function catalogEntry(id: string): SourceCatalogEntry | undefined {
  return SOURCE_CATALOG.find((s) => s.id === id);
}

export function catalogSummary() {
  const byDomain: Record<string, number> = {};
  for (const s of SOURCE_CATALOG) {
    byDomain[s.domain] = (byDomain[s.domain] ?? 0) + 1;
  }
  return { total: SOURCE_CATALOG.length, byDomain, sources: SOURCE_CATALOG };
}
