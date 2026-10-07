import "server-only";
import { httpJson } from "../http";
import type { ChartCandle } from "../chart-const";
import { ProviderError } from "./binance";

/**
 * Yahoo Finance public chart API — no API key.
 * Approved public fallback provider for FX/commodity OHLC (Yahoo Finance
 * chart v8 endpoints). Host rotation for resilience.
 */

export const YAHOO = "yahoo";

const HOSTS = [
  "https://query1.finance.yahoo.com",
  "https://query2.finance.yahoo.com",
];

let lastGood = 0;

type YahooChartResult = {
  chart?: {
    result?: {
      meta?: {
        symbol?: string;
        regularMarketPrice?: number;
        previousClose?: number;
        chartPreviousClose?: number;
        regularMarketDayHigh?: number;
        regularMarketDayLow?: number;
        regularMarketTime?: number;
        currency?: string;
      };
      timestamp?: number[];
      indicators?: {
        quote?: {
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }[];
      };
    }[];
  };
};

export type YahooResult = {
  candles: ChartCandle[];
  meta: {
    symbol: string;
    currency: string | null;
    regularMarketPrice: number | null;
  };
};

export async function getYahooChart(yahooSymbol: string, interval: string, range: string): Promise<YahooResult> {
  let lastErr = "unreachable";
  for (let i = 0; i < HOSTS.length; i++) {
    const idx = (lastGood + i) % HOSTS.length;
    const res = await httpJson<YahooChartResult>(
      `${HOSTS[idx]}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}&includePrePost=false`,
      { provider: YAHOO, timeoutMs: 10_000, retries: 1 },
    );
    const result = res.data?.chart?.result?.[0];
    if (!res.ok || !result?.timestamp?.length) {
      lastErr = res.error ?? "empty";
      continue;
    }
    lastGood = idx;
    const q = result.indicators?.quote?.[0];
    const candles: ChartCandle[] = [];
    for (let j = 0; j < result.timestamp.length; j++) {
      const t = result.timestamp[j]! * 1000;
      const open = q?.open?.[j];
      const high = q?.high?.[j];
      const low = q?.low?.[j];
      const close = q?.close?.[j];
      if (open == null || high == null || low == null || close == null) continue;
      if (!(close > 0)) continue;
      candles.push({
        time: t,
        open,
        high,
        low,
        close,
        volume: q?.volume?.[j] ?? 0,
      });
    }
    return {
      candles,
      meta: {
        symbol: result.meta?.symbol ?? yahooSymbol,
        currency: result.meta?.currency ?? null,
        regularMarketPrice: result.meta?.regularMarketPrice ?? null,
      },
    };
  }
  throw new ProviderError(`yahoo chart: ${lastErr}`, YAHOO);
}

/** Binance-style BTCUSDT / ETHUSDT → Yahoo BTC-USD (public, no key). */
export function yahooCryptoSymbol(symbol: string): string {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.endsWith("USDT")) return `${s.slice(0, -4)}-USD`;
  if (s.endsWith("USD") && s.length > 3) return `${s.slice(0, -3)}-USD`;
  if (s.includes("-")) return s;
  return `${s}-USD`;
}

const YAHOO_PAIR_SYMBOL: Record<string, string> = {
  XAUUSD: "GC=F",
  GOLD: "GC=F",
  XAU: "GC=F",
  XAGUSD: "SI=F",
  SILVER: "SI=F",
  XAG: "SI=F",
  USOIL: "CL=F",
  WTI: "CL=F",
  CRUDE: "CL=F",
  CL: "CL=F",
  BRENT: "BZ=F",
  NATGAS: "NG=F",
  COPPER: "HG=F",
  DXY: "DX-Y.NYB",
  USDOLLAR: "DX-Y.NYB",
  US500: "^GSPC",
  US30: "^DJI",
  USTEC: "^NDX",
};

/** map "EURUSD" → "EURUSD=X"; metals/oil use futures; never emit invalid COMMODITY=X */
export function yahooSymbolForPair(pair: string): string {
  const p = pair.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (YAHOO_PAIR_SYMBOL[p]) return YAHOO_PAIR_SYMBOL[p]!;
  if (/^[A-Z]{6}$/.test(p)) return `${p}=X`;
  if (p.length <= 5) return p;
  return `${p}=X`;
}

export interface YahooQuote {
  symbol: string;
  price: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  currency: string | null;
  marketTime: number | null;
}

type YahooMetaResp = {
  chart?: {
    result?: {
      meta?: {
        symbol?: string;
        regularMarketPrice?: number;
        previousClose?: number;
        chartPreviousClose?: number;
        regularMarketDayHigh?: number;
        regularMarketDayLow?: number;
        regularMarketTime?: number;
        currency?: string;
      };
    }[];
  };
};

/** Latest quote via the public chart meta (no key, real provider timestamps). */
export async function getYahooQuote(yahooSymbol: string): Promise<YahooQuote> {
  let lastErr = "unreachable";
  for (let i = 0; i < HOSTS.length; i++) {
    const idx = (lastGood + i) % HOSTS.length;
    const res = await httpJson<YahooMetaResp>(
      `${HOSTS[idx]}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=5d`,
      { provider: YAHOO, timeoutMs: 8_000, retries: 1 },
    );
    const m = res.data?.chart?.result?.[0]?.meta;
    if (res.ok && m && typeof m.regularMarketPrice === "number") {
      lastGood = idx;
      const price = m.regularMarketPrice;
      const prev = m.previousClose ?? m.chartPreviousClose ?? null;
      const change = prev != null ? price - prev : null;
      const changePercent = prev != null && prev !== 0 ? ((price - prev) / prev) * 100 : null;
      return {
        symbol: m.symbol ?? yahooSymbol,
        price,
        previousClose: prev,
        change,
        changePercent,
        dayHigh: m.regularMarketDayHigh ?? null,
        dayLow: m.regularMarketDayLow ?? null,
        currency: m.currency ?? null,
        marketTime: m.regularMarketTime ? m.regularMarketTime * 1000 : null,
      };
    }
    lastErr = res.error ?? "empty";
  }
  throw new ProviderError(`yahoo quote: ${lastErr}`, YAHOO);
}

export async function getYahooQuotes(symbols: string[]): Promise<Map<string, YahooQuote>> {
  const out = new Map<string, YahooQuote>();
  const chunk = 6;
  for (let i = 0; i < symbols.length; i += chunk) {
    const batch = symbols.slice(i, i + chunk);
    const results = await Promise.allSettled(batch.map((s) => getYahooQuote(s)));
    results.forEach((r, j) => {
      if (r.status === "fulfilled") out.set(batch[j]!, r.value);
    });
  }
  return out;
}

/**
 * Yahoo public chart range ceilings (approx):
 * - 1m: ~7d, 2m–90m: ~60d, 60m/1h: ~730d
 * - 1d / 1wk: multi-year, 1mo: max
 * Futures (GC=F etc.) downsample to monthly when range=max — prefer 2y for true daily bars.
 */
const INTRADAY_LIMITS: Record<string, { interval: string; range: string }> = {
  "1m": { interval: "1m", range: "7d" },
  "5m": { interval: "5m", range: "60d" },
  "15m": { interval: "15m", range: "60d" },
  "30m": { interval: "30m", range: "60d" },
  "1h": { interval: "60m", range: "730d" },
  "4h": { interval: "60m", range: "730d" },
  "1d": { interval: "1d", range: "2y" },
  "1w": { interval: "1wk", range: "5y" },
  "1M": { interval: "1mo", range: "max" },
  "12M": { interval: "1mo", range: "max" },
};

export function yahooIntervalFor(tf: string): { interval: string; range: string } | null {
  if (INTRADAY_LIMITS[tf]) return INTRADAY_LIMITS[tf]!;
  return null;
}
