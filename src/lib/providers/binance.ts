import "server-only";
import { env } from "../env";
import { httpJson } from "../http";
import type { OhlcvBar } from "../types";

/**
 * Binance provider adapter — primary crypto source.
 *
 * Public market data requires no key. The adapter fails over across multiple
 * Binance API hosts (regional restrictions happen), starting from the last
 * host that succeeded. Futures metrics come from fapi hosts and degrade
 * gracefully where geo-blocked — never fabricated.
 */

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly cause2?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

const SPOT_HOSTS = [
  env.binanceBaseUrl,
  "https://data-api.binance.vision",
  "https://api1.binance.com",
  "https://api2.binance.com",
  "https://api.binance.com",
].filter((h): h is string => Boolean(h));

const FUTURES_HOSTS = [env.binanceFapiBaseUrl, "https://fapi.binance.com", "https://fapi1.binance.com"].filter(
  (h): h is string => Boolean(h),
);

let lastGoodSpot = 0;
let lastGoodFutures = 0;

export interface BinanceTicker24h {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  weightedAvgPrice: string;
  prevClosePrice?: string;
  lastPrice: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openTime?: number;
  closeTime?: number;
  count?: number;
}

export interface FundingInfo {
  symbol: string;
  markPrice: number;
  indexPrice: number;
  fundingRate: number;
  nextFundingTime: number;
}

export const BINANCE_SPOT = "binance-spot";
export const BINANCE_FUTURES = "binance-futures";

async function getFromHosts<T>(hosts: string[], startIdx: number, path: string, provider: string): Promise<{ data: T; hostIdx: number }> {
  let lastErr = "unreachable";
  for (let i = 0; i < hosts.length; i++) {
    const idx = (startIdx + i) % hosts.length;
    const url = `${hosts[idx]}${path}`;
    const res = await httpJson<T>(url, { provider, timeoutMs: 8_000, retries: 1 });
    if (res.ok && res.data != null) return { data: res.data, hostIdx: idx };
    lastErr = res.error ?? "unreachable";
  }
  throw new ProviderError(`${provider}: all hosts failed (${lastErr})`, provider);
}

/** Full market 24h tickers (single request covers the whole spot market). */
export async function getAllSpotTickers(): Promise<BinanceTicker24h[]> {
  const { data, hostIdx } = await getFromHosts<BinanceTicker24h[]>(SPOT_HOSTS, lastGoodSpot, `/api/v3/ticker/24hr`, BINANCE_SPOT);
  lastGoodSpot = hostIdx;
  return data;
}

export async function getSpotTicker(symbol: string): Promise<BinanceTicker24h> {
  const { data, hostIdx } = await getFromHosts<BinanceTicker24h>(
    SPOT_HOSTS,
    lastGoodSpot,
    `/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`,
    BINANCE_SPOT,
  );
  lastGoodSpot = hostIdx;
  return data;
}

type RawKline = [number, string, string, string, string, string, number, string, number, string, string, string];

export async function getKlines(symbol: string, interval: string, limit = 200): Promise<OhlcvBar[]> {
  const { data, hostIdx } = await getFromHosts<RawKline[]>(
    SPOT_HOSTS,
    lastGoodSpot,
    `/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`,
    BINANCE_SPOT,
  );
  lastGoodSpot = hostIdx;
  return data.map((k) => ({
    time: k[0],
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  }));
}

/** Futures mark price + funding rate (may be geo-blocked → throws ProviderError). */
export async function getFundingRate(symbol: string): Promise<FundingInfo> {
  type Premium = { symbol: string; markPrice: string; indexPrice: string; lastFundingRate: string; nextFundingTime: number };
  const { data, hostIdx } = await getFromHosts<Premium>(
    FUTURES_HOSTS,
    lastGoodFutures,
    `/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`,
    BINANCE_FUTURES,
  );
  lastGoodFutures = hostIdx;
  return {
    symbol: data.symbol,
    markPrice: Number(data.markPrice),
    indexPrice: Number(data.indexPrice),
    fundingRate: Number(data.lastFundingRate),
    nextFundingTime: data.nextFundingTime,
  };
}

export async function getAllFundingRates(): Promise<FundingInfo[]> {
  type Premium = { symbol: string; markPrice: string; indexPrice: string; lastFundingRate: string; nextFundingTime: number };
  const { data, hostIdx } = await getFromHosts<Premium[]>(FUTURES_HOSTS, lastGoodFutures, `/fapi/v1/premiumIndex`, BINANCE_FUTURES);
  lastGoodFutures = hostIdx;
  return data.map((d) => ({
    symbol: d.symbol,
    markPrice: Number(d.markPrice),
    indexPrice: Number(d.indexPrice),
    fundingRate: Number(d.lastFundingRate),
    nextFundingTime: d.nextFundingTime,
  }));
}

/** Open interest for a perpetual contract. */
export async function getOpenInterest(symbol: string): Promise<{ symbol: string; openInterest: number; time: number }> {
  type OI = { symbol: string; openInterest: string; time: number };
  const { data, hostIdx } = await getFromHosts<OI>(
    FUTURES_HOSTS,
    lastGoodFutures,
    `/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`,
    BINANCE_FUTURES,
  );
  lastGoodFutures = hostIdx;
  return { symbol: data.symbol, openInterest: Number(data.openInterest), time: data.time };
}

export interface DepthLevel {
  price: number;
  qty: number;
}

export interface OrderBookSnapshot {
  lastUpdateId: number;
  bids: DepthLevel[];
  asks: DepthLevel[];
}

/** Spot order book depth (REST). limit: 5|10|20|50|100 */
export async function getOrderBook(symbol: string, limit = 20): Promise<OrderBookSnapshot> {
  type Raw = { lastUpdateId: number; bids: [string, string][]; asks: [string, string][] };
  const { data, hostIdx } = await getFromHosts<Raw>(
    SPOT_HOSTS,
    lastGoodSpot,
    `/api/v3/depth?symbol=${encodeURIComponent(symbol)}&limit=${limit}`,
    BINANCE_SPOT,
  );
  lastGoodSpot = hostIdx;
  return {
    lastUpdateId: data.lastUpdateId,
    bids: data.bids.map(([p, q]) => ({ price: Number(p), qty: Number(q) })),
    asks: data.asks.map(([p, q]) => ({ price: Number(p), qty: Number(q) })),
  };
}

export interface AggTrade {
  id: number;
  price: number;
  qty: number;
  quoteQty: number;
  time: number;
  isBuyerMaker: boolean;
}

/** Recent aggregate trades — large prints for flow proxy. */
export async function getAggTrades(symbol: string, limit = 80): Promise<AggTrade[]> {
  type Raw = { a: number; p: string; q: string; f: number; l: number; T: number; m: boolean }[];
  const { data, hostIdx } = await getFromHosts<Raw>(
    SPOT_HOSTS,
    lastGoodSpot,
    `/api/v3/aggTrades?symbol=${encodeURIComponent(symbol)}&limit=${limit}`,
    BINANCE_SPOT,
  );
  lastGoodSpot = hostIdx;
  return data.map((t) => {
    const price = Number(t.p);
    const qty = Number(t.q);
    return {
      id: t.a,
      price,
      qty,
      quoteQty: price * qty,
      time: t.T,
      isBuyerMaker: t.m,
    };
  });
}
