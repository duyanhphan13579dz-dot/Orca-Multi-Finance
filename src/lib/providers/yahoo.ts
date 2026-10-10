import "server-only";
import { httpJson } from "../http";
import type { ChartCandle } from "../chart-const";
import { ProviderError } from "./binance";

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
      { provider: YAHOO, timeoutMs: 4_200, retries: 0 },
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
  XPTUSD: "PL=F",
  PLATINUM: "PL=F",
  XPDUSD: "PA=F",
  PALLADIUM: "PA=F",
  USOIL: "CL=F",
  OILUSD: "CL=F",
  WTIUSD: "CL=F",
  WTI: "CL=F",
  CRUDE: "CL=F",
  CL: "CL=F",
  UKOIL: "BZ=F",
  BRENT: "BZ=F",
  BRENTUSD: "BZ=F",
  NATGAS: "NG=F",
  NGUSD: "NG=F",
  COPPER: "HG=F",
  HGUSD: "HG=F",
  DXY: "DX-Y.NYB",
  USDOLLAR: "DX-Y.NYB",
  US500: "^GSPC",
  US30: "^DJI",
  USTEC: "^NDX",
};

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

export async function getYahooQuote(yahooSymbol: string): Promise<YahooQuote> {
  let lastErr = "unreachable";
  for (let i = 0; i < HOSTS.length; i++) {
    const idx = (lastGood + i) % HOSTS.length;
    const res = await httpJson<YahooMetaResp>(
      `${HOSTS[idx]}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=5d`,
      { provider: YAHOO, timeoutMs: 3_500, retries: 0 },
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

/**
 * P3-C: batch Yahoo quotes with race-first early exit.
 * - concurrency 5, per-symbol soft 3.5s
 * - exit when coverage >= 70% or hard budget 5.5s
 * - do not wait for slowest host on every symbol
 */
export async function getYahooQuotes(symbols: string[]): Promise<Map<string, YahooQuote>> {
  const out = new Map<string, YahooQuote>();
  const uniq = [...new Set(symbols.filter(Boolean))].slice(0, 16);
  if (!uniq.length) return out;

  const EXIT_COVERAGE = 0.7;
  const HARD_MS = 5_500;
  const PER_MS = 3_500;
  const concurrency = Math.min(5, uniq.length);
  const t0 = Date.now();
  let next = 0;
  let settled = false;

  await new Promise<void>((resolve) => {
    const hardStop = setTimeout(() => {
      settled = true;
      resolve();
    }, HARD_MS);

    const workers = Array.from({ length: concurrency }, async () => {
      while (!settled) {
        const i = next++;
        if (i >= uniq.length) break;
        if (Date.now() - t0 >= HARD_MS) break;
        const sym = uniq[i]!;
        try {
          const q = await Promise.race([
            getYahooQuote(sym),
            new Promise<null>((r) => setTimeout(() => r(null), PER_MS)),
          ]);
          if (q) out.set(sym, q);
        } catch {
          /* skip */
        }
        if (!settled && out.size / uniq.length >= EXIT_COVERAGE) {
          settled = true;
          clearTimeout(hardStop);
          resolve();
          break;
        }
      }
    });

    void Promise.all(workers).then(() => {
      if (!settled) {
        settled = true;
        clearTimeout(hardStop);
        resolve();
      }
    });
  });

  return out;
}

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
