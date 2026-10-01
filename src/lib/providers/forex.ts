import "server-only";
import { env } from "../env";
import { httpJson } from "../http";
import { ProviderError } from "./binance";
import type { OhlcvBar } from "../types";

/**
 * Forex / metals providers — real-time first.
 *
 * Priority (quotes):
 *   1. Biquote public (https://biquote.io) — no key, MT5 tick stream, FX + XAU/XAG
 *   2. Biquote env-configured (/v1/quotes) if BIQUOTE_* set
 *   3. open.er-api.com USD-based live rates
 *
 * Priority (OHLC / chart):
 *   1. Biquote public /api/{symbol}/ohlc (1m–1d)
 *   2. Yahoo Finance chart (caller-side fallback)
 *
 * Daily reference history: Frankfurter / ECB
 */

export const BIQUOTE = "biquote-forex";
export const BIQUOTE_PUBLIC = "biquote-public";
export const ER_API = "exchangerate-api";
export const FRANKFURTER = "frankfurter-ecb";

const BIQUOTE_PUBLIC_BASE = "https://biquote.io";

export interface FxLatest {
  base: string;
  rates: Record<string, number>;
  ts: number;
  source: string;
}

export interface BiquoteTick {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  high: number | null;
  low: number | null;
  dayDiffPercent: number | null;
  timestamp: number;
  marketState: string;
  stale: boolean;
  source: string;
}

export function biquoteIntervalFor(tf: string): string | null {
  const map: Record<string, string> = {
    "1m": "1m",
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "1h": "1h",
    "4h": "4h",
    "1d": "1d",
    "1w": "1d",
    "1M": "1d",
    "12M": "1d",
  };
  return map[tf] ?? null;
}

function normalizePair(symbol: string): string {
  return symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function parseTick(raw: Record<string, unknown>): BiquoteTick | null {
  const symbol = String(raw.symbol ?? "").toUpperCase();
  if (!symbol) return null;
  const bid = Number(raw.bid);
  const ask = Number(raw.ask);
  const mid =
    Number(raw.mid) ||
    (Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : Number(raw.last ?? raw.price ?? raw.rate));
  if (!Number.isFinite(mid) || mid <= 0) return null;
  const tsRaw = raw.timestamp ?? raw.lastQuoteAt ?? raw.time;
  let timestamp = Date.now();
  if (typeof tsRaw === "number") timestamp = tsRaw > 1e12 ? tsRaw : tsRaw * 1000;
  else if (typeof tsRaw === "string") {
    const p = Date.parse(tsRaw);
    if (Number.isFinite(p)) timestamp = p;
  }
  return {
    symbol,
    bid: Number.isFinite(bid) ? bid : mid,
    ask: Number.isFinite(ask) ? ask : mid,
    mid,
    spread: Number(raw.spread) || Math.abs((Number.isFinite(ask) ? ask : mid) - (Number.isFinite(bid) ? bid : mid)),
    high: Number.isFinite(Number(raw.high)) ? Number(raw.high) : null,
    low: Number.isFinite(Number(raw.low)) ? Number(raw.low) : null,
    dayDiffPercent: Number.isFinite(Number(raw.dayDiffPercent)) ? Number(raw.dayDiffPercent) : null,
    timestamp,
    marketState: String(raw.marketState ?? "unknown"),
    stale: Boolean(raw.stale),
    source: String(raw.source ?? "biquote"),
  };
}

export async function getBiquotePublicTick(symbol: string): Promise<BiquoteTick> {
  const sym = normalizePair(symbol);
  const res = await httpJson<Record<string, unknown>>(`${BIQUOTE_PUBLIC_BASE}/api/${encodeURIComponent(sym)}`, {
    provider: BIQUOTE_PUBLIC,
    timeoutMs: 5_000,
    retries: 1,
  });
  if (!res.ok || !res.data) throw new ProviderError(`biquote-public tick: ${res.error ?? "unreachable"}`, BIQUOTE_PUBLIC);
  const tick = parseTick(res.data);
  if (!tick) throw new ProviderError(`biquote-public: invalid tick for ${sym}`, BIQUOTE_PUBLIC);
  return tick;
}

export async function getBiquotePublicQuotes(
  pairs: string[],
): Promise<{ rates: Record<string, number>; ticks: Record<string, BiquoteTick>; ts: number | null }> {
  const symbols = pairs.map(normalizePair).filter(Boolean);
  if (!symbols.length) return { rates: {}, ticks: {}, ts: null };

  const qs = symbols.map((s) => `symbols=${encodeURIComponent(s)}`).join("&");
  const res = await httpJson<Record<string, unknown>>(`${BIQUOTE_PUBLIC_BASE}/api/latest?${qs}`, {
    provider: BIQUOTE_PUBLIC,
    timeoutMs: 6_000,
    retries: 1,
  });
  if (!res.ok || !res.data) throw new ProviderError(`biquote-public latest: ${res.error ?? "unreachable"}`, BIQUOTE_PUBLIC);

  const rates: Record<string, number> = {};
  const ticks: Record<string, BiquoteTick> = {};
  let ts: number | null = null;

  const payload = res.data;
  const entries: [string, unknown][] = Array.isArray(payload)
    ? (payload as unknown[]).map((item) => {
        const rec = item as Record<string, unknown>;
        return [String(rec.symbol ?? ""), item];
      })
    : Object.entries(payload);

  for (const [k, v] of entries) {
    if (!v || typeof v !== "object") continue;
    const tick = parseTick(v as Record<string, unknown>);
    if (!tick) continue;
    const key = normalizePair(tick.symbol || k);
    rates[key] = tick.mid;
    ticks[key] = tick;
    if (ts == null || tick.timestamp > ts) ts = tick.timestamp;
  }

  if (!Object.keys(rates).length) throw new ProviderError("biquote-public: empty payload", BIQUOTE_PUBLIC);
  return { rates, ticks, ts };
}

export async function getBiquotePublicOhlc(
  symbol: string,
  interval: string,
  limit = 500,
): Promise<OhlcvBar[]> {
  const sym = normalizePair(symbol);
  const iv = biquoteIntervalFor(interval) ?? interval;
  const lim = Math.min(Math.max(limit, 1), 1000);
  const url = `${BIQUOTE_PUBLIC_BASE}/api/${encodeURIComponent(sym)}/ohlc?interval=${encodeURIComponent(iv)}&limit=${lim}`;
  const res = await httpJson<{ symbol?: string; interval?: string; bars?: unknown[] }>(url, {
    provider: BIQUOTE_PUBLIC,
    timeoutMs: 8_000,
    retries: 1,
  });
  if (!res.ok || !res.data) throw new ProviderError(`biquote-public ohlc: ${res.error ?? "unreachable"}`, BIQUOTE_PUBLIC);
  const barsRaw = res.data.bars ?? (Array.isArray(res.data) ? (res.data as unknown[]) : []);
  const bars: OhlcvBar[] = [];
  for (const item of barsRaw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const openTime = r.openTime ?? r.time ?? r.t;
    let time = 0;
    if (typeof openTime === "number") time = openTime > 1e12 ? openTime : openTime * 1000;
    else if (typeof openTime === "string") time = Date.parse(openTime);
    const open = Number(r.open ?? r.o);
    const high = Number(r.high ?? r.h);
    const low = Number(r.low ?? r.l);
    const close = Number(r.close ?? r.c);
    const volume = Number(r.volume ?? r.tickVolume ?? r.v ?? 0);
    if (!Number.isFinite(time) || !Number.isFinite(open) || !Number.isFinite(close)) continue;
    bars.push({
      time,
      open,
      high: Number.isFinite(high) ? high : Math.max(open, close),
      low: Number.isFinite(low) ? low : Math.min(open, close),
      close,
      volume: Number.isFinite(volume) ? volume : 0,
    });
  }
  bars.sort((a, b) => a.time - b.time);
  if (!bars.length) throw new ProviderError(`biquote-public ohlc: empty bars for ${sym}`, BIQUOTE_PUBLIC);
  return bars;
}

export async function getBiquoteQuotes(pairs: string[]): Promise<{ rates: Record<string, number>; ts: number | null }> {
  if (!env.biquoteBaseUrl || !env.biquoteApiKey) throw new ProviderError("Biquote not configured", BIQUOTE);
  const res = await httpJson<unknown>(`${env.biquoteBaseUrl.replace(/\/$/, "")}/v1/quotes?symbols=${pairs.join(",")}`, {
    provider: BIQUOTE,
    headers: { Authorization: `Bearer ${env.biquoteApiKey}`, "x-api-key": env.biquoteApiKey },
    timeoutMs: 7_000,
    retries: 1,
  });
  if (!res.ok || res.data == null) throw new ProviderError(`biquote: ${res.error ?? "unreachable"}`, BIQUOTE);
  const payload = res.data as Record<string, unknown>;
  const container = (payload.data ?? payload.rates ?? payload) as Record<string, unknown>;
  const rates: Record<string, number> = {};
  for (const [k, v] of Object.entries(container)) {
    if (v && typeof v === "object") {
      const rec = v as Record<string, unknown>;
      const price = Number(rec.price ?? rec.rate ?? rec.last ?? rec.mid);
      if (Number.isFinite(price)) rates[k.toUpperCase().replace("/", "")] = price;
    } else {
      const price = Number(v);
      if (Number.isFinite(price)) rates[k.toUpperCase().replace("/", "")] = price;
    }
  }
  if (!Object.keys(rates).length) throw new ProviderError("biquote: empty payload", BIQUOTE);
  const tsRaw = payload.timestamp ?? payload.time ?? payload.updatedAt;
  const ts = typeof tsRaw === "number" ? (tsRaw > 1e12 ? tsRaw : tsRaw * 1000) : Date.parse(String(tsRaw ?? ""));
  return { rates, ts: Number.isFinite(ts) ? ts : null };
}

export async function getRealtimeFxQuotes(
  pairs: string[],
): Promise<{ rates: Record<string, number>; ticks?: Record<string, BiquoteTick>; ts: number | null; source: string }> {
  try {
    const pub = await getBiquotePublicQuotes(pairs);
    return { rates: pub.rates, ticks: pub.ticks, ts: pub.ts, source: BIQUOTE_PUBLIC };
  } catch {
    /* fall through */
  }
  if (env.biquoteBaseUrl && env.biquoteApiKey) {
    const priv = await getBiquoteQuotes(pairs);
    return { rates: priv.rates, ts: priv.ts, source: BIQUOTE };
  }
  throw new ProviderError("no realtime forex provider available", BIQUOTE_PUBLIC);
}

type ErApiPayload = {
  result: string;
  time_last_update_unix: number;
  time_last_update_utc: string;
  base_code: string;
  rates: Record<string, number>;
};

export async function getErApiLatest(): Promise<FxLatest> {
  const res = await httpJson<ErApiPayload>("https://open.er-api.com/v6/latest/USD", {
    provider: ER_API,
    timeoutMs: 7_000,
    retries: 1,
  });
  if (!res.ok || !res.data || res.data.result !== "success") {
    throw new ProviderError(`exchangerate-api: ${res.error ?? "unreachable"}`, ER_API);
  }
  return {
    base: "USD",
    rates: res.data.rates,
    ts: res.data.time_last_update_unix * 1000,
    source: "exchangerate-api (open)",
  };
}

type FrankfurterSeries = {
  amount: number;
  base: string;
  start_date: string;
  end_date: string;
  rates: Record<string, Record<string, number>>;
};

export async function getFrankfurterSeries(base: string, quote: string, days = 366): Promise<{ date: string; rate: number }[]> {
  const end = new Date();
  const start = new Date(Date.now() - days * 86_400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const res = await httpJson<FrankfurterSeries>(
    `https://api.frankfurter.dev/v1/${fmt(start)}..${fmt(end)}?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(quote)}`,
    { provider: FRANKFURTER, timeoutMs: 9_000, retries: 1 },
  );
  if (!res.ok || !res.data) throw new ProviderError(`frankfurter: ${res.error ?? "unreachable"}`, FRANKFURTER);
  return Object.entries(res.data.rates)
    .map(([date, r]) => ({ date, rate: r[quote] }))
    .filter((x) => Number.isFinite(x.rate))
    .sort((a, b) => a.date.localeCompare(b.date));
}
