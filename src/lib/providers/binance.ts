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
  // Prefer vision endpoint first — less geo-blocked from many Vercel regions
  "https://data-api.binance.vision",
  "https://api1.binance.com",
  "https://api2.binance.com",
  "https://api3.binance.com",
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
    // Isolate circuit state per host so one geo-blocked endpoint does not block all failovers
    const hostProvider = i === 0 ? provider : `${provider}:h${idx}`;
    const res = await httpJson<T>(url, { provider: hostProvider, timeoutMs: 8_000, retries: 1 });
    if (res.ok && res.data != null) {
      if (i > 0) {
        try {
          const { recordSuccess } = await import("../health");
          recordSuccess(provider, res.latencyMs ?? 0);
        } catch {
          /* ignore */
        }
      }
      return { data: res.data, hostIdx: idx };
    }
    lastErr = res.error ?? "unreachable";
  }
  throw new ProviderError(`${provider}: all hosts failed (${lastErr})`, provider);
}

export const binance = {
  async getSpotTicker(symbol: string): Promise<BinanceTicker24h> {
    const { data, hostIdx } = await getFromHosts<BinanceTicker24h>(
      SPOT_HOSTS,
      lastGoodSpot,
      `/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`,
      BINANCE_SPOT,
    );
    lastGoodSpot = hostIdx;
    return data;
  },

  async getAllSpotTickers(): Promise<BinanceTicker24h[]> {
    const { data, hostIdx } = await getFromHosts<BinanceTicker24h[]>(SPOT_HOSTS, lastGoodSpot, `/api/v3/ticker/24hr`, BINANCE_SPOT);
    lastGoodSpot = hostIdx;
    return data;
  },

  async getKlines(symbol: string, interval: string, limit = 200): Promise<OhlcvBar[]> {
    const { data, hostIdx } = await getFromHosts<unknown[][]>(
      SPOT_HOSTS,
      lastGoodSpot,
      `/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`,
      BINANCE_SPOT,
    );
    lastGoodSpot = hostIdx;
    return data.map((row) => ({
      time: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    }));
  },

  async getFundingRate(symbol: string): Promise<FundingInfo | null> {
    try {
      const { data, hostIdx } = await getFromHosts<Record<string, string>>(
        FUTURES_HOSTS,
        lastGoodFutures,
        `/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`,
        BINANCE_FUTURES,
      );
      lastGoodFutures = hostIdx;
      return {
        symbol,
        markPrice: Number(data.markPrice),
        indexPrice: Number(data.indexPrice),
        fundingRate: Number(data.lastFundingRate),
        nextFundingTime: Number(data.nextFundingTime),
      };
    } catch {
      return null;
    }
  },

  async getOpenInterest(symbol: string): Promise<{ openInterest: number; time: number }> {
    const { data, hostIdx } = await getFromHosts<Record<string, string>>(
      FUTURES_HOSTS,
      lastGoodFutures,
      `/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`,
      BINANCE_FUTURES,
    );
    lastGoodFutures = hostIdx;
    return { openInterest: Number(data.openInterest), time: Date.now() };
  },
};
