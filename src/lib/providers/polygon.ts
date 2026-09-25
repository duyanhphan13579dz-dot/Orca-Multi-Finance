import "server-only";
import { httpJson } from "../http";
import { ProviderError } from "./binance";

/**
 * Polygon.io market data — US equities / indices via internal proxy or public API.
 * Env: POLYGON_API_KEY, POLYGON_API_BASE_URL
 */

export const POLYGON = "polygon";

export type PolygonTickerQuote = {
  symbol: string;
  price: number;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  updatedAt: string | null;
};

function polygonBase(): string {
  const base =
    process.env.POLYGON_API_BASE_URL?.trim() ||
    "https://api.polygon.io";
  return base.replace(/\/$/, "");
}

function polygonKey(): string | undefined {
  return process.env.POLYGON_API_KEY?.trim() || undefined;
}

function authQuery(): string {
  const key = polygonKey();
  return key ? `apiKey=${encodeURIComponent(key)}` : "";
}

export async function getPolygonTickerSnapshot(
  ticker: string,
): Promise<PolygonTickerQuote> {
  const sym = ticker.toUpperCase().replace(/[^A-Z0-9.]/g, "");
  if (!sym) throw new ProviderError("polygon: empty ticker", POLYGON);

  const base = polygonBase();
  const q = authQuery();
  const url = `${base}/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(sym)}${q ? `?${q}` : ""}`;

  const res = await httpJson<{
    status?: string;
    ticker?: {
      ticker?: string;
      day?: { o?: number; h?: number; l?: number; c?: number; v?: number };
      prevDay?: { c?: number };
      min?: { c?: number; v?: number };
      todaysChange?: number;
      todaysChangePerc?: number;
      updated?: number;
    };
  }>(url, {
    provider: POLYGON,
    timeoutMs: 8_000,
    retries: 1,
    headers: { Accept: "application/json" },
  });

  if (!res.ok || !res.data?.ticker) {
    throw new ProviderError(`polygon: ${res.error ?? "no ticker"}`, POLYGON);
  }

  const t = res.data.ticker;
  const price = Number(t.min?.c ?? t.day?.c ?? t.prevDay?.c);
  if (!Number.isFinite(price) || price <= 0) {
    throw new ProviderError(`polygon: invalid price for ${sym}`, POLYGON);
  }

  const prev = t.prevDay?.c != null ? Number(t.prevDay.c) : null;
  const change =
    t.todaysChange != null && Number.isFinite(Number(t.todaysChange))
      ? Number(t.todaysChange)
      : prev != null
        ? price - prev
        : null;
  const changePercent =
    t.todaysChangePerc != null && Number.isFinite(Number(t.todaysChangePerc))
      ? Number(t.todaysChangePerc)
      : prev != null && prev !== 0
        ? ((price - prev) / prev) * 100
        : null;

  return {
    symbol: t.ticker ?? sym,
    price,
    change,
    changePercent,
    open: t.day?.o != null ? Number(t.day.o) : null,
    high: t.day?.h != null ? Number(t.day.h) : null,
    low: t.day?.l != null ? Number(t.day.l) : null,
    volume: t.day?.v != null ? Number(t.day.v) : t.min?.v != null ? Number(t.min.v) : null,
    updatedAt: t.updated ? new Date(t.updated / 1e6).toISOString() : new Date().toISOString(),
  };
}

const DEFAULT_INDICES = ["SPY", "QQQ", "DIA", "IWM", "VIXY"] as const;

export async function getPolygonIndexSnapshots(
  tickers: string[] = [...DEFAULT_INDICES],
): Promise<{ rows: PolygonTickerQuote[]; sourceTs: number }> {
  const unique = [...new Set(tickers.map((t) => t.toUpperCase()).filter(Boolean))].slice(0, 20);
  const results = await Promise.allSettled(unique.map((t) => getPolygonTickerSnapshot(t)));
  const rows: PolygonTickerQuote[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") rows.push(r.value);
  }
  if (!rows.length) {
    throw new ProviderError("polygon: all snapshots failed", POLYGON);
  }
  return { rows, sourceTs: Date.now() };
}

export async function getPolygonPrevClose(ticker: string): Promise<PolygonTickerQuote> {
  const sym = ticker.toUpperCase().replace(/[^A-Z0-9.]/g, "");
  const base = polygonBase();
  const q = authQuery();
  const url = `${base}/v2/aggs/ticker/${encodeURIComponent(sym)}/prev${q ? `?adjusted=true&${q}` : "?adjusted=true"}`;

  const res = await httpJson<{
    results?: { c?: number; o?: number; h?: number; l?: number; v?: number; t?: number }[];
  }>(url, {
    provider: POLYGON,
    timeoutMs: 8_000,
    retries: 1,
    headers: { Accept: "application/json" },
  });

  const bar = res.data?.results?.[0];
  if (!res.ok || !bar?.c) {
    throw new ProviderError(`polygon prev: ${res.error ?? "empty"}`, POLYGON);
  }
  const price = Number(bar.c);
  return {
    symbol: sym,
    price,
    change: null,
    changePercent: null,
    open: bar.o != null ? Number(bar.o) : null,
    high: bar.h != null ? Number(bar.h) : null,
    low: bar.l != null ? Number(bar.l) : null,
    volume: bar.v != null ? Number(bar.v) : null,
    updatedAt: bar.t ? new Date(bar.t).toISOString() : new Date().toISOString(),
  };
}
