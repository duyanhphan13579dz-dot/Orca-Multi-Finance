import "server-only";
import { httpJson } from "../http";
import { ProviderError } from "./binance";
import { ssiFcConfigured, getSsiAccessToken, ssiToday } from "./ssi-fcdata";
import type { DerivativeQuote, OhlcvBar } from "../types";

/**
 * HNX derivatives market-data adapter (P0).
 *
 * Priority:
 *  1) SSI FastConnect Data with market=DER (when SSI credentials configured)
 *  2) Optional third-party feed via DERIVATIVES_QUOTE_URL (server-side only)
 *
 * Never invents prices. Callers must treat null quotes as UNAVAILABLE.
 */

export const HNX_DERIVATIVES = "hnx-derivatives";

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(String(v).replace(/,/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};

type SsiEnvelope<T> = {
  status?: number | string;
  message?: string;
  data?: T;
  totalRecord?: number;
};

type SsiPriceRow = Record<string, unknown>;

function mapRowToQuote(symbol: string, r: SsiPriceRow, source: string): DerivativeQuote | null {
  const last =
    num(r.Close) ??
    num(r.close) ??
    num(r.LastPrice) ??
    num(r.lastPrice) ??
    num(r.Last) ??
    num(r.last) ??
    num(r.Price) ??
    num(r.price);
  if (last == null || last <= 0) return null;

  const open = num(r.Open) ?? num(r.open);
  const high = num(r.High) ?? num(r.high);
  const low = num(r.Low) ?? num(r.low);
  const volume =
    num(r.Volume) ??
    num(r.volume) ??
    num(r.TotalMatchVolume) ??
    num(r.MatchVolume) ??
    num(r.matchVolume);
  const openInterest =
    num(r.OpenInterest) ?? num(r.openInterest) ?? num(r.OI) ?? num(r.oi) ?? num(r.Open_Interest);
  const change = num(r.Change) ?? num(r.change) ?? num(r.PriceChange);
  const changePercent =
    num(r.PerChange) ??
    num(r.perChange) ??
    num(r.ChangePercent) ??
    num(r.changePercent) ??
    num(r.PercentPriceChange);
  const ref = num(r.RefPrice) ?? num(r.ReferencePrice) ?? num(r.referencePrice);
  const ceiling = num(r.CeilingPrice) ?? num(r.ceilingPrice);
  const floor = num(r.FloorPrice) ?? num(r.floorPrice);

  let tradingDate = r.TradingDate ?? r.tradingDate ?? r.Time ?? r.time;
  let updatedAt: string | null = null;
  if (typeof tradingDate === "string" && tradingDate) {
    const m = tradingDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      updatedAt = new Date(
        `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T15:00:00+07:00`,
      ).toISOString();
    } else {
      const t = Date.parse(tradingDate);
      if (Number.isFinite(t)) updatedAt = new Date(t).toISOString();
    }
  }

  return {
    symbol: symbol.toUpperCase(),
    last,
    change,
    changePercent,
    open,
    high,
    low,
    volume,
    openInterest,
    settlement: num(r.SettlementPrice) ?? num(r.settlementPrice),
    mark: null,
    ceiling,
    floor,
    reference: ref,
    updatedAt,
    source,
  };
}

async function ssiGet<T>(
  path: string,
  query: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const token = await getSsiAccessToken();
  const base = (process.env.SSI_FC_DATA_BASE_URL ?? "https://fc-data.ssi.com.vn").replace(/\/$/, "");
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === "") continue;
    qs.set(k, String(v));
  }
  const url = `${base}${path}?${qs.toString()}`;
  const res = await httpJson<T>(url, {
    provider: "ssi-fcdata",
    timeoutMs: 10_000,
    retries: 1,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!res.ok || res.data == null) {
    throw new ProviderError(`ssi-der: ${res.error ?? `HTTP ${res.status}`}`, HNX_DERIVATIVES);
  }
  return res.data;
}

/**
 * Fetch daily price row for a DER symbol via SSI FastConnect (when configured).
 */
export async function fetchSsiDerivativeQuote(symbol: string): Promise<DerivativeQuote | null> {
  if (!ssiFcConfigured()) return null;
  const sym = symbol.toUpperCase();
  const today = ssiToday();
  try {
    const body = await ssiGet<SsiEnvelope<SsiPriceRow[]>>("/api/v2/Market/DailyStockPrice", {
      Symbol: sym,
      symbol: sym,
      FromDate: today,
      fromDate: today,
      ToDate: today,
      toDate: today,
      PageIndex: 1,
      pageIndex: 1,
      PageSize: 10,
      pageSize: 10,
      Market: "DER",
      market: "DER",
    });
    const rows = Array.isArray(body.data) ? body.data : [];
    for (const r of rows) {
      const q = mapRowToQuote(sym, r, "ssi-fcdata");
      if (q) return q;
    }
  } catch {
    /* try DailyOhlc as secondary */
  }

  try {
    const body = await ssiGet<SsiEnvelope<SsiPriceRow[]>>("/api/v2/Market/DailyOhlc", {
      Symbol: sym,
      symbol: sym,
      FromDate: today,
      fromDate: today,
      ToDate: today,
      toDate: today,
      PageIndex: 1,
      pageIndex: 1,
      PageSize: 5,
      pageSize: 5,
    });
    const rows = Array.isArray(body.data) ? body.data : [];
    for (const r of rows) {
      const q = mapRowToQuote(sym, r, "ssi-fcdata");
      if (q) return q;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Optional generic JSON quote endpoint:
 *   DERIVATIVES_QUOTE_URL=https://…/quotes?symbol={symbol}
 */
export async function fetchExternalDerivativeQuote(symbol: string): Promise<DerivativeQuote | null> {
  const template = process.env.DERIVATIVES_QUOTE_URL?.trim();
  if (!template) return null;
  const sym = symbol.toUpperCase();
  const url = template.includes("{symbol}")
    ? template.replaceAll("{symbol}", encodeURIComponent(sym))
    : `${template}${template.includes("?") ? "&" : "?"}symbol=${encodeURIComponent(sym)}`;
  const res = await httpJson<Record<string, unknown>>(url, {
    provider: HNX_DERIVATIVES,
    timeoutMs: 8_000,
    retries: 1,
    headers: process.env.DERIVATIVES_QUOTE_API_KEY
      ? { Authorization: `Bearer ${process.env.DERIVATIVES_QUOTE_API_KEY}` }
      : undefined,
  });
  if (!res.ok || res.data == null) return null;
  const raw = (res.data.data as Record<string, unknown> | undefined) ?? res.data;
  return mapRowToQuote(sym, raw, "derivatives-quote-url");
}

/**
 * Best-effort quote: SSI DER → external URL → null.
 */
export async function getDerivativeMarketQuote(symbol: string): Promise<DerivativeQuote | null> {
  const sym = symbol.toUpperCase();
  try {
    const ssi = await fetchSsiDerivativeQuote(sym);
    if (ssi) return ssi;
  } catch {
    /* continue */
  }
  try {
    const ext = await fetchExternalDerivativeQuote(sym);
    if (ext) return ext;
  } catch {
    /* continue */
  }
  return null;
}

export async function getDerivativeMarketQuotes(
  symbols: string[],
): Promise<Map<string, DerivativeQuote>> {
  const out = new Map<string, DerivativeQuote>();
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
  await Promise.all(
    uniq.map(async (sym) => {
      try {
        const q = await getDerivativeMarketQuote(sym);
        if (q) out.set(sym, q);
      } catch {
        /* skip */
      }
    }),
  );
  return out;
}

export function derivativesLiveConfigured(): boolean {
  return ssiFcConfigured() || Boolean(process.env.DERIVATIVES_QUOTE_URL?.trim());
}

function daysAgoSsiLocal(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")}`;
}

function parseSsiBarDate(d: string | null | undefined): number | null {
  if (!d) return null;
  const m = String(d).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const t = Date.parse(
      `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T15:00:00+07:00`,
    );
    return Number.isFinite(t) ? t : null;
  }
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : null;
}

/**
 * Daily OHLCV for a derivative symbol (P1).
 * SSI DailyOhlc when configured; optional DERIVATIVES_OHLCV_URL.
 */
export async function fetchDerivativeOhlcv(
  symbol: string,
  days = 60,
): Promise<OhlcvBar[]> {
  const sym = symbol.toUpperCase();
  const limit = Math.min(Math.max(days, 5), 250);

  if (ssiFcConfigured()) {
    try {
      const body = await ssiGet<SsiEnvelope<SsiPriceRow[]>>("/api/v2/Market/DailyOhlc", {
        Symbol: sym,
        symbol: sym,
        FromDate: daysAgoSsiLocal(limit + 5),
        fromDate: daysAgoSsiLocal(limit + 5),
        ToDate: ssiToday(),
        toDate: ssiToday(),
        PageIndex: 1,
        pageIndex: 1,
        PageSize: Math.min(limit, 1000),
        pageSize: Math.min(limit, 1000),
        ascending: true,
      });
      const rows = Array.isArray(body.data) ? body.data : [];
      const bars: OhlcvBar[] = [];
      for (const r of rows) {
        const time = parseSsiBarDate(
          String(r.TradingDate ?? r.tradingDate ?? r.Time ?? r.time ?? ""),
        );
        const open = num(r.Open ?? r.open);
        const high = num(r.High ?? r.high);
        const low = num(r.Low ?? r.low);
        const close = num(r.Close ?? r.close ?? r.LastPrice ?? r.last);
        const volume = num(r.Volume ?? r.volume ?? r.TotalMatchVolume) ?? 0;
        if (time == null || open == null || high == null || low == null || close == null) continue;
        if (close <= 0) continue;
        bars.push({ time, open, high, low, close, volume });
      }
      bars.sort((a, b) => a.time - b.time);
      if (bars.length) return bars.slice(-limit);
    } catch {
      /* fall through */
    }
  }

  const template = process.env.DERIVATIVES_OHLCV_URL?.trim();
  if (template) {
    const url = template.includes("{symbol}")
      ? template.replaceAll("{symbol}", encodeURIComponent(sym))
      : `${template}${template.includes("?") ? "&" : "?"}symbol=${encodeURIComponent(sym)}`;
    const res = await httpJson<{ bars?: OhlcvBar[]; data?: OhlcvBar[] } | OhlcvBar[]>(url, {
      provider: HNX_DERIVATIVES,
      timeoutMs: 10_000,
      retries: 1,
      headers: process.env.DERIVATIVES_QUOTE_API_KEY
        ? { Authorization: `Bearer ${process.env.DERIVATIVES_QUOTE_API_KEY}` }
        : undefined,
    });
    if (res.ok && res.data) {
      const raw = Array.isArray(res.data)
        ? res.data
        : (res.data.bars ?? res.data.data ?? []);
      return raw
        .filter((b) => b && Number(b.close) > 0 && Number(b.time) > 0)
        .map((b) => ({
          time: Number(b.time),
          open: Number(b.open),
          high: Number(b.high),
          low: Number(b.low),
          close: Number(b.close),
          volume: Number(b.volume) || 0,
        }))
        .sort((a, b) => a.time - b.time)
        .slice(-limit);
    }
  }

  return [];
}
