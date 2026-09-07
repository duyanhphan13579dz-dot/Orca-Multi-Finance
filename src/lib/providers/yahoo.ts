import "server-only";
import { httpJson } from "../http";
import type { ChartCandle } from "../chart-const";
import { ProviderError } from "./binance";

/**
 * Approved public fallback provider for FX/commodity OHLC (Yahoo Finance
 * public chart endpoint — no key, real timestamps, exchange timezone meta).
 * Used only when Biquote/primary paths cannot supply historical candles.
 */

export const YAHOO = "yahoo-fx";

const HOSTS = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
let lastGood = 0;

type YahooChartResp = {
  chart?: {
    result?: {
      meta?: { regularMarketPrice?: number; regularMarketTime?: number; exchangeTimezoneName?: string; currency?: string };
      timestamp?: number[];
      indicators?: { quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }[] };
    }[];
    error?: { code?: string; description?: string } | null;
  };
};

export interface YahooResult {
  candles: ChartCandle[];
  timezone: string | null;
  currency: string | null;
  regularMarketTime: number | null;
}

export async function getYahooChart(yahooSymbol: string, interval: string, range: string): Promise<YahooResult> {
  let lastErr = "unreachable";
  for (let i = 0; i < HOSTS.length; i++) {
    const idx = (lastGood + i) % HOSTS.length;
    const res = await httpJson<YahooChartResp>(
      `${HOSTS[idx]}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}&includePrePost=false`,
      { provider: YAHOO, timeoutMs: 9_000, retries: 1 },
    );
    if (res.ok && res.data?.chart?.result?.[0]) {
      lastGood = idx;
      const r = res.data.chart.result[0];
      const ts = r.timestamp ?? [];
      const q = r.indicators?.quote?.[0];
      const candles: ChartCandle[] = [];
      for (let k = 0; k < ts.length; k++) {
        const o = q?.open?.[k];
        const h = q?.high?.[k];
        const l = q?.low?.[k];
        const c = q?.close?.[k];
        if (o == null || h == null || l == null || c == null) continue;
        candles.push({ time: ts[k] * 1000, open: o, high: h, low: l, close: c, volume: q?.volume?.[k] ?? 0 });
      }
      if (!candles.length) continue;
      return {
        candles,
        timezone: r.meta?.exchangeTimezoneName ?? null,
        currency: r.meta?.currency ?? null,
        regularMarketTime: r.meta?.regularMarketTime ? r.meta.regularMarketTime * 1000 : null,
      };
    }
    lastErr = res.data?.chart?.error?.description ?? res.error ?? "unreachable";
  }
  throw new ProviderError(`yahoo: ${lastErr}`, YAHOO);
}

/** Yahoo symbols for FX (=X) and CFD/futures on the forex board. */
const YAHOO_PAIR_SYMBOL: Record<string, string> = {
  XAUUSD: "GC=F", // COMEX Gold futures — more reliable than XAUUSD=X
  XAGUSD: "SI=F", // COMEX Silver futures
  USOIL: "CL=F",
  USTEC: "^NDX",
};

/** map "EURUSD" → "EURUSD=X"; metals/oil/index use dedicated tickers */
export function yahooSymbolForPair(pair: string): string {
  const p = pair.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (YAHOO_PAIR_SYMBOL[p]) return YAHOO_PAIR_SYMBOL[p];
  return `${p}=X`;
}

/* --------------------------- quote snapshot API ---------------------------- */

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
      const prev = m.previousClose ?? m.chartPreviousClose ?? null;
      const price = m.regularMarketPrice;
      return {
        symbol: m.symbol ?? yahooSymbol,
        price,
        previousClose: prev,
        change: prev != null ? price - prev : null,
        changePercent: prev ? ((price - prev) / prev) * 100 : null,
        dayHigh: m.regularMarketDayHigh ?? null,
        dayLow: m.regularMarketDayLow ?? null,
        currency: m.currency ?? null,
        marketTime: m.regularMarketTime ? m.regularMarketTime * 1000 : null,
      };
    }
    lastErr = res.error ?? "no_meta";
  }
  throw new ProviderError(`yahoo quote: ${lastErr}`, YAHOO);
}

/** Batch quotes with bounded concurrency; partial success is preserved. */
export async function getYahooQuotes(symbols: string[]): Promise<Map<string, YahooQuote>> {
  const out = new Map<string, YahooQuote>();
  const chunk = 6;
  for (let i = 0; i < symbols.length; i += chunk) {
    const batch = symbols.slice(i, i + chunk);
    const results = await Promise.allSettled(batch.map((s) => getYahooQuote(s)));
    results.forEach((r, j) => {
      if (r.status === "fulfilled") out.set(batch[j], r.value);
    });
  }
  return out;
}

const INTRADAY_LIMITS: Record<string, string> = {
  "1m": "7d", "2m": "60d", "5m": "60d", "15m": "60d", "30m": "60d", "60m": "730d", "90m": "60d", "1h": "730d",
  "1d": "10y", "1wk": "10y", "1mo": "max", "1w": "10y",
};

export function yahooIntervalFor(tf: string): { interval: string; range: string; aggregate4h?: boolean } | null {
  if (tf === "4h") return { interval: "1h", range: "730d", aggregate4h: true };
  if (tf === "1w") return { interval: "1wk", range: "10y" };
  if (tf === "1M") return { interval: "1mo", range: "max" };
  if (INTRADAY_LIMITS[tf]) return { interval: tf === "1h" ? "1h" : tf, range: INTRADAY_LIMITS[tf] };
  return null;
}
