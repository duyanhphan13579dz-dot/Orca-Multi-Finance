import "server-only";
import { env } from "../env";
import { httpJson } from "../http";
import { ProviderError } from "./binance";
import type { OhlcvBar } from "../types";

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

const PAIR_ALIASES: Record<string, string> = {
  OILUSD: "USOIL",
  WTIUSD: "USOIL",
  WTI: "USOIL",
  BRENT: "UKOIL",
  BRENTUSD: "UKOIL",
  GOLD: "XAUUSD",
  XAU: "XAUUSD",
  SILVER: "XAGUSD",
  XAG: "XAGUSD",
};

function normalizePair(symbol: string): string {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return PAIR_ALIASES[s] ?? s;
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
  const res = await httpJson<Record<string, unknown>>(`${BIQUOTE_PUBLIC_BASE}/api/${encodeURIComponent(sym)}/tick`, {
    provider: BIQUOTE_PUBLIC,
    timeoutMs: 3_500,
    retries: 0,
  });
  const tick = res.ok && res.data ? parseTick(res.data) : null;
  if (!tick) throw new ProviderError(`biquote public tick empty: ${sym}`, BIQUOTE_PUBLIC);
  return tick;
}

/**
 * P1: batch via GET /api/latest?symbols=A&symbols=B (1 subrequest)
 * Docs: https://biquote.io/docs/
 */
export async function getBiquotePublicQuotes(
  pairs: string[],
): Promise<{ rates: Record<string, number>; ticks: Record<string, BiquoteTick>; ts: number | null }> {
  const uniq = [...new Set(pairs.map(normalizePair).filter(Boolean))].slice(0, 40);
  const rates: Record<string, number> = {};
  const ticks: Record<string, BiquoteTick> = {};
  let ts: number | null = null;

  if (uniq.length) {
    try {
      const qs = uniq.map((s) => `symbols=${encodeURIComponent(s)}`).join("&");
      const res = await httpJson<Record<string, Record<string, unknown>>>(
        `${BIQUOTE_PUBLIC_BASE}/api/latest?${qs}`,
        { provider: BIQUOTE_PUBLIC, timeoutMs: 5_000, retries: 0 },
      );
      if (res.ok && res.data && typeof res.data === "object") {
        for (const [key, raw] of Object.entries(res.data)) {
          if (!raw || typeof raw !== "object") continue;
          const tick = parseTick({ ...raw, symbol: raw.symbol ?? key });
          if (!tick) continue;
          rates[tick.symbol] = tick.mid;
          ticks[tick.symbol] = tick;
          if (ts == null || tick.timestamp > ts) ts = tick.timestamp;
          const want = uniq.find((u) => u === tick.symbol || normalizePair(u) === tick.symbol);
          if (want && want !== tick.symbol) {
            rates[want] = tick.mid;
            ticks[want] = tick;
          }
        }
      }
    } catch {
      /* fall through */
    }
  }

  const missing = uniq.filter((p) => rates[p] == null);
  if (missing.length && Object.keys(rates).length === 0) {
    const limited = missing.slice(0, 6);
    const settled = await Promise.allSettled(
      limited.map((p) =>
        Promise.race([
          getBiquotePublicTick(p),
          new Promise<null>((r) => setTimeout(() => r(null), 3_000)),
        ]),
      ),
    );
    for (const s of settled) {
      if (s.status !== "fulfilled" || !s.value) continue;
      const tick = s.value;
      rates[tick.symbol] = tick.mid;
      ticks[tick.symbol] = tick;
      if (ts == null || tick.timestamp > ts) ts = tick.timestamp;
    }
  }

  if (!Object.keys(rates).length) throw new ProviderError("biquote public quotes empty", BIQUOTE_PUBLIC);
  return { rates, ticks, ts };
}

export async function getBiquotePublicOhlc(
  symbol: string,
  tf: string,
  limit = 300,
): Promise<OhlcvBar[]> {
  const sym = normalizePair(symbol);
  const interval = biquoteIntervalFor(tf) ?? "1d";
  const res = await httpJson<{ candles?: unknown[]; data?: unknown[] } | unknown[]>(
    `${BIQUOTE_PUBLIC_BASE}/api/${encodeURIComponent(sym)}/ohlc?interval=${encodeURIComponent(interval)}&limit=${limit}`,
    { provider: BIQUOTE_PUBLIC, timeoutMs: 8_000, retries: 1 },
  );
  const raw = Array.isArray(res.data)
    ? res.data
    : (res.data as { candles?: unknown[] })?.candles ?? (res.data as { data?: unknown[] })?.data ?? [];
  const bars: OhlcvBar[] = [];
  for (const row of raw as Record<string, unknown>[]) {
    const time = Number(row.time ?? row.t ?? row.timestamp);
    const open = Number(row.open ?? row.o);
    const high = Number(row.high ?? row.h);
    const low = Number(row.low ?? row.l);
    const close = Number(row.close ?? row.c);
    if (!(time > 0) || !(close > 0)) continue;
    bars.push({
      time: time > 1e12 ? time : time * 1000,
      open: open || close,
      high: high || close,
      low: low || close,
      close,
      volume: Number(row.volume ?? row.v ?? 0) || 0,
    });
  }
  return bars.sort((a, b) => a.time - b.time).slice(-limit);
}

export async function getBiquoteQuotes(pairs: string[]): Promise<{ rates: Record<string, number>; ts: number | null }> {
  const base = (env.biquoteBaseUrl ?? "").replace(/\/$/, "");
  if (!base || !env.biquoteApiKey) throw new ProviderError("biquote not configured", BIQUOTE);
  const rates: Record<string, number> = {};
  let ts: number | null = null;
  for (const p of pairs.slice(0, 20)) {
    const res = await httpJson<Record<string, unknown>>(`${base}/v1/quotes/${encodeURIComponent(p)}`, {
      provider: BIQUOTE,
      timeoutMs: 4_000,
      retries: 0,
      headers: { Authorization: `Bearer ${env.biquoteApiKey}` },
    });
    if (!res.ok || !res.data) continue;
    const mid = Number(res.data.mid ?? res.data.price ?? res.data.rate);
    if (!(mid > 0)) continue;
    rates[normalizePair(p)] = mid;
    const t = Number(res.data.timestamp ?? res.data.ts);
    if (t > 0) ts = t > 1e12 ? t : t * 1000;
  }
  if (!Object.keys(rates).length) throw new ProviderError("biquote private empty", BIQUOTE);
  return { rates, ts };
}

export async function getRealtimeFxQuotes(
  pairs: string[],
): Promise<{ rates: Record<string, number>; ticks?: Record<string, BiquoteTick>; ts: number | null; source: string }> {
  const want = [...new Set(pairs.map((p) => p.toUpperCase().replace(/[^A-Z0-9]/g, "")).filter(Boolean))];
  const rates: Record<string, number> = {};
  const ticks: Record<string, BiquoteTick> = {};
  const sources: string[] = [];
  let ts: number | null = null;

  const jobs: Promise<void>[] = [];

  jobs.push(
    (async () => {
      try {
        const pub = await Promise.race([
          getBiquotePublicQuotes(want),
          new Promise<null>((r) => setTimeout(() => r(null), 5_000)),
        ]);
        if (!pub) return;
        for (const [k, v] of Object.entries(pub.rates ?? {})) {
          if (Number.isFinite(v) && (v as number) > 0) rates[k] = v as number;
        }
        if (pub.ticks) Object.assign(ticks, pub.ticks);
        if (pub.ts) ts = pub.ts;
        if (Object.keys(pub.rates ?? {}).length) sources.push(BIQUOTE_PUBLIC);
      } catch {
        /* */
      }
    })(),
  );

  jobs.push(
    (async () => {
      try {
        const er = await Promise.race([
          getErApiLatest(),
          new Promise<null>((r) => setTimeout(() => r(null), 4_500)),
        ]);
        if (!er?.rates) return;
        let hit = 0;
        for (const p of want) {
          if (rates[p] != null) continue;
          if (p.length !== 6) continue;
          const base = p.slice(0, 3);
          const quote = p.slice(3);
          const rb = base === "USD" ? 1 : er.rates[base];
          const rq = quote === "USD" ? 1 : er.rates[quote];
          if (!(rb > 0) || !(rq > 0)) continue;
          let price: number | null = null;
          if (base === "USD") price = rq;
          else if (quote === "USD") price = 1 / rb;
          else price = rq / rb;
          if (price && price > 0) {
            rates[p] = price;
            hit += 1;
          }
        }
        if (hit) {
          sources.push(ER_API);
          if (er.ts && (ts == null || er.ts > ts)) ts = er.ts;
        }
      } catch {
        /* */
      }
    })(),
  );

  await Promise.all(jobs);

  if (!Object.keys(rates).length) {
    if (env.biquoteBaseUrl && env.biquoteApiKey) {
      const priv = await getBiquoteQuotes(want);
      return { rates: priv.rates, ts: priv.ts, source: BIQUOTE };
    }
    throw new ProviderError("no realtime forex provider available", BIQUOTE_PUBLIC);
  }

  return {
    rates,
    ticks: Object.keys(ticks).length ? ticks : undefined,
    ts: ts ?? Date.now(),
    source: sources.join("+") || BIQUOTE_PUBLIC,
  };
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
    timeoutMs: 5_000,
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

export async function getFrankfurterSeries(
  base: string,
  quote: string,
  days = 366,
): Promise<{ date: string; rate: number }[]> {
  const end = new Date();
  const start = new Date(Date.now() - days * 86_400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const res = await httpJson<FrankfurterSeries>(
    `https://api.frankfurter.dev/v1/${fmt(start)}..${fmt(end)}?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(quote)}`,
    { provider: FRANKFURTER, timeoutMs: 7_000, retries: 1 },
  );
  if (!res.ok || !res.data) throw new ProviderError(`frankfurter: ${res.error ?? "unreachable"}`, FRANKFURTER);
  return Object.entries(res.data.rates)
    .map(([date, r]) => ({ date, rate: r[quote] }))
    .filter((x) => Number.isFinite(x.rate))
    .sort((a, b) => a.date.localeCompare(b.date));
}
