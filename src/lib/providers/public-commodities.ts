import "server-only";
import { httpJson } from "../http";

/** Public commodity / global futures via Yahoo Finance chart API (no key). */

export const PUBLIC_COMMODITIES = "yahoo-finance-public";

export interface CommodityQuote {
  symbol: string;
  yahoo: string;
  name: string;
  category: "metals" | "energy" | "agriculture" | "index";
  last: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  currency: string;
  updatedAt: string | null;
  source: string;
}

const BOARD: Array<{
  symbol: string;
  yahoo: string;
  name: string;
  category: CommodityQuote["category"];
}> = [
  { symbol: "GC", yahoo: "GC=F", name: "Gold", category: "metals" },
  { symbol: "SI", yahoo: "SI=F", name: "Silver", category: "metals" },
  { symbol: "HG", yahoo: "HG=F", name: "Copper", category: "metals" },
  { symbol: "CL", yahoo: "CL=F", name: "WTI Crude", category: "energy" },
  { symbol: "BZ", yahoo: "BZ=F", name: "Brent", category: "energy" },
  { symbol: "NG", yahoo: "NG=F", name: "Natural Gas", category: "energy" },
  { symbol: "ZC", yahoo: "ZC=F", name: "Corn", category: "agriculture" },
  { symbol: "ZW", yahoo: "ZW=F", name: "Wheat", category: "agriculture" },
  { symbol: "ES", yahoo: "ES=F", name: "E-mini S&P 500", category: "index" },
];

type YahooChart = {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        previousClose?: number;
        chartPreviousClose?: number;
        currency?: string;
        regularMarketTime?: number;
        symbol?: string;
      };
    }>;
  };
};

async function fetchYahoo(yahooSym: string): Promise<CommodityQuote | null> {
  const def = BOARD.find((b) => b.yahoo === yahooSym);
  if (!def) return null;
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}` +
    `?interval=1d&range=5d`;
  try {
    const data = await httpJson<YahooChart>(url, {
      provider: PUBLIC_COMMODITIES,
      timeoutMs: 8_000,
      retries: 1,
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; OrcaFinance/1.0)",
      },
    });
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const last = meta.regularMarketPrice ?? null;
    const prev = meta.previousClose ?? meta.chartPreviousClose ?? null;
    const change = last != null && prev != null ? last - prev : null;
    const changePercent =
      change != null && prev != null && prev !== 0 ? (change / prev) * 100 : null;
    return {
      symbol: def.symbol,
      yahoo: def.yahoo,
      name: def.name,
      category: def.category,
      last: last != null && Number.isFinite(last) ? last : null,
      previousClose: prev,
      change,
      changePercent,
      currency: meta.currency ?? "USD",
      updatedAt: meta.regularMarketTime
        ? new Date(meta.regularMarketTime * 1000).toISOString()
        : new Date().toISOString(),
      source: PUBLIC_COMMODITIES,
    };
  } catch {
    return null;
  }
}

export async function getPublicCommodityBoard(): Promise<CommodityQuote[]> {
  const results = await Promise.all(BOARD.map((b) => fetchYahoo(b.yahoo)));
  return results.filter((q): q is CommodityQuote => q != null && q.last != null);
}

export function listCommodityBoardDefs() {
  return BOARD;
}
