import "server-only";
import { httpJson } from "../http";
import type { Quote } from "../types";

/**
 * Vietcap IQ Insight — profile + currentPrice (public).
 * https://iq.vietcap.com.vn/api/iq-insight-service/v1/company/{TICKER}
 */

const BASE = "https://iq.vietcap.com.vn/api/iq-insight-service/v1";

type VietcapCompany = {
  ticker?: string;
  currentPrice?: number;
  marketCap?: number;
  numberOfSharesMktCap?: number;
  issueShare?: number;
  viOrganName?: string;
  viOrganShortName?: string;
  enOrganName?: string;
  sectorVn?: string;
  sector?: string;
  comGroupCode?: string;
  listingDate?: string;
  listing?: boolean;
  highestPrice1Year?: number;
  lowestPrice1Year?: number;
};

type Envelope = {
  successful?: boolean;
  data?: VietcapCompany | null;
};

export type VietcapProfile = {
  symbol: string;
  name: string | null;
  nameEn: string | null;
  sector: string | null;
  exchange: string | null;
  price: number | null;
  marketCap: number | null;
  sharesOutstanding: number | null;
  listedDate: string | null;
  listing: boolean;
};

export async function getVietcapCompany(symbol: string): Promise<VietcapProfile | null> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return null;
  const res = await httpJson<Envelope>(`${BASE}/company/${sym}`, {
    provider: "vietcap",
    timeoutMs: 8_000,
    retries: 1,
    headers: {
      Accept: "application/json",
      Origin: "https://iq.vietcap.com.vn",
      Referer: "https://iq.vietcap.com.vn/",
    },
  });
  if (!res.ok || !res.data?.successful || !res.data.data) return null;
  const d = res.data.data;
  const ticker = String(d.ticker ?? sym).toUpperCase();
  return {
    symbol: ticker,
    name: d.viOrganName ?? d.viOrganShortName ?? null,
    nameEn: d.enOrganName ?? null,
    sector: d.sectorVn ?? d.sector ?? null,
    exchange: d.comGroupCode === "VNINDEX" ? "HOSE" : d.comGroupCode ?? null,
    price: d.currentPrice ?? null,
    marketCap: d.marketCap ?? null,
    sharesOutstanding: d.issueShare ?? d.numberOfSharesMktCap ?? null,
    listedDate: d.listingDate ? String(d.listingDate).slice(0, 10) : null,
    listing: Boolean(d.listing),
  };
}

export async function getVietcapQuotes(symbols: string[]): Promise<{
  quotes: Quote[];
  sourceTs: number | null;
}> {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))].slice(0, 20);
  const results = await Promise.allSettled(uniq.map((s) => getVietcapCompany(s)));
  const quotes: Quote[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled" || !r.value) continue;
    const p = r.value;
    const price = p.price;
    if (price == null || !(price > 0)) continue;
    quotes.push({
      symbol: p.symbol,
      assetClass: "stock",
      name: p.name,
      price,
      change: null,
      changePercent: null,
      open: null,
      high: null,
      low: null,
      volume: null,
      quoteVolume: null,
      referencePrice: null,
      ceilingPrice: null,
      floorPrice: null,
      updatedAt: new Date().toISOString(),
    });
  }
  return { quotes, sourceTs: quotes.length ? Date.now() : null };
}
