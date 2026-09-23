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
  | "vn-stock";

export type SourceKind = "quotes" | "fundamentals" | "ohlcv" | "news" | "macro" | "screener" | "health";

export interface SourceEntry {
  id: string;
  name: string;
  domain: SourceDomain;
  kinds: SourceKind[];
  priority: number; // lower = preferred
  ttlSec: number;
  swrSec?: number;
  notes?: string;
}

/** Canonical list — keep in sync with actual adapters */
export const SOURCE_CATALOG: SourceEntry[] = [
  // --- VN Stock quotes ---
  {
    id: "vndirect",
    name: "VNDIRECT",
    domain: "vn-stock",
    kinds: ["quotes", "fundamentals", "ohlcv"],
    priority: 1,
    ttlSec: 30,
    swrSec: 120,
    notes: "Primary VN quote + financial package",
  },
  {
    id: "ssi",
    name: "SSI",
    domain: "vn-stock",
    kinds: ["quotes"],
    priority: 2,
    ttlSec: 30,
    swrSec: 120,
  },
  {
    id: "tcbs",
    name: "TCBS",
    domain: "vn-stock",
    kinds: ["quotes", "fundamentals"],
    priority: 3,
    ttlSec: 45,
    swrSec: 180,
  },
  {
    id: "cafef",
    name: "CafeF",
    domain: "vn-stock",
    kinds: ["quotes", "news"],
    priority: 4,
    ttlSec: 60,
    swrSec: 300,
  },
  // --- Market / indices ---
  {
    id: "yahoo",
    name: "Yahoo Finance",
    domain: "market",
    kinds: ["quotes", "ohlcv"],
    priority: 1,
    ttlSec: 60,
    swrSec: 300,
  },
  {
    id: "investing",
    name: "Investing.com",
    domain: "market",
    kinds: ["quotes", "macro"],
    priority: 2,
    ttlSec: 90,
    swrSec: 300,
  },
  // --- Crypto ---
  {
    id: "binance",
    name: "Binance",
    domain: "crypto",
    kinds: ["quotes", "ohlcv"],
    priority: 1,
    ttlSec: 15,
    swrSec: 60,
  },
  {
    id: "coingecko",
    name: "CoinGecko",
    domain: "crypto",
    kinds: ["quotes", "fundamentals"],
    priority: 2,
    ttlSec: 60,
    swrSec: 300,
  },
  // --- Forex ---
  {
    id: "exchangerate",
    name: "ExchangeRate-API",
    domain: "forex",
    kinds: ["quotes"],
    priority: 1,
    ttlSec: 300,
    swrSec: 900,
  },
  {
    id: "frankfurter",
    name: "Frankfurter",
    domain: "forex",
    kinds: ["quotes"],
    priority: 2,
    ttlSec: 300,
    swrSec: 900,
  },
  // --- Commodity ---
  {
    id: "metals-api",
    name: "Metals-API",
    domain: "commodity",
    kinds: ["quotes"],
    priority: 1,
    ttlSec: 120,
    swrSec: 600,
  },
  // --- News ---
  {
    id: "rss-vn",
    name: "VN News RSS",
    domain: "news",
    kinds: ["news"],
    priority: 1,
    ttlSec: 300,
    swrSec: 900,
  },
  {
    id: "rss-global",
    name: "Global News RSS",
    domain: "news",
    kinds: ["news"],
    priority: 2,
    ttlSec: 300,
    swrSec: 900,
  },
  // --- Macro ---
  {
    id: "fred",
    name: "FRED",
    domain: "macro",
    kinds: ["macro"],
    priority: 1,
    ttlSec: 3600,
    swrSec: 7200,
  },
  {
    id: "worldbank",
    name: "World Bank",
    domain: "macro",
    kinds: ["macro"],
    priority: 2,
    ttlSec: 86400,
    swrSec: 172800,
  },
  // --- Financial package (fundamentals) ---
  {
    id: "vndirect-fin",
    name: "VNDIRECT Financials",
    domain: "financial",
    kinds: ["fundamentals"],
    priority: 1,
    ttlSec: 3600,
    swrSec: 7200,
    notes: "Income / balance / cashflow periods",
  },
  {
    id: "ssi-fin",
    name: "SSI Financials",
    domain: "financial",
    kinds: ["fundamentals"],
    priority: 2,
    ttlSec: 3600,
    swrSec: 7200,
  },
  {
    id: "cafef-fin",
    name: "CafeF Financials",
    domain: "financial",
    kinds: ["fundamentals"],
    priority: 3,
    ttlSec: 3600,
    swrSec: 7200,
  },
  {
    id: "fireant",
    name: "FireAnt",
    domain: "financial",
    kinds: ["fundamentals", "screener"],
    priority: 4,
    ttlSec: 1800,
    swrSec: 3600,
  },
];

export function catalogByDomain(domain: SourceDomain): SourceEntry[] {
  return SOURCE_CATALOG.filter((s) => s.domain === domain).sort(
    (a, b) => a.priority - b.priority,
  );
}

export function catalogByKind(kind: SourceKind): SourceEntry[] {
  return SOURCE_CATALOG.filter((s) => s.kinds.includes(kind)).sort(
    (a, b) => a.priority - b.priority,
  );
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
      priority: s.priority,
      ttlSec: s.ttlSec,
    })),
  };
}
