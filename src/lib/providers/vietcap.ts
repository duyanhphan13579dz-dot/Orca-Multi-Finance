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
  enOrganShortName?: string;
  sectorVn?: string;
  sector?: string;
  comGroupCode?: string;
  comTypeCode?: string;
  listingDate?: string;
  listing?: boolean;
  highestPrice1Year?: number;
  lowestPrice1Year?: number;
  foreignerPercentage?: number;
  freeFloat?: number;
  freeFloatPercentage?: number;
  statePercentage?: number;
  maximumForeignPercentage?: number;
  profile?: string;
  enProfile?: string;
  rating?: string;
  ratingAsOf?: string;
  targetPrice?: number;
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
  /** 0–100 style percentages from Vietcap when available */
  foreignerPct: number | null;
  freeFloatPct: number | null;
  statePct: number | null;
  maxForeignPct: number | null;
  profileVn: string | null;
  profileEn: string | null;
  rating: string | null;
  ratingAsOf: string | null;
  targetPrice: number | null;
  comType: string | null;
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
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
  });
  if (!res.ok || !res.data?.successful || !res.data.data) return null;
  const d = res.data.data;
  const ticker = String(d.ticker ?? sym).toUpperCase();
  const pct = (v: unknown): number | null => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    // Vietcap may return 0–1 or 0–100
    if (n > 0 && n <= 1) return Math.round(n * 10000) / 100;
    return Math.round(n * 100) / 100;
  };
  return {
    symbol: ticker,
    name: d.viOrganName ?? d.viOrganShortName ?? null,
    nameEn: d.enOrganName ?? d.enOrganShortName ?? null,
    sector: d.sectorVn ?? d.sector ?? null,
    exchange: d.comGroupCode === "VNINDEX" ? "HOSE" : d.comGroupCode ?? null,
    price: d.currentPrice ?? null,
    marketCap: d.marketCap ?? null,
    sharesOutstanding: d.issueShare ?? d.numberOfSharesMktCap ?? null,
    listedDate: d.listingDate ? String(d.listingDate).slice(0, 10) : null,
    listing: Boolean(d.listing),
    foreignerPct: pct(d.foreignerPercentage),
    freeFloatPct: pct(d.freeFloatPercentage),
    statePct: pct(d.statePercentage),
    maxForeignPct: pct(d.maximumForeignPercentage),
    profileVn: typeof d.profile === "string" && d.profile.trim() ? d.profile.trim() : null,
    profileEn: typeof d.enProfile === "string" && d.enProfile.trim() ? d.enProfile.trim() : null,
    rating: typeof d.rating === "string" ? d.rating : null,
    ratingAsOf: typeof d.ratingAsOf === "string" ? d.ratingAsOf : null,
    targetPrice: d.targetPrice != null && Number.isFinite(Number(d.targetPrice)) ? Number(d.targetPrice) : null,
    comType: typeof d.comTypeCode === "string" ? d.comTypeCode : null,
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
