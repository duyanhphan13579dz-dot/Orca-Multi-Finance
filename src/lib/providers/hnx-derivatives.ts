import "server-only";
import { httpJson } from "../http";
import { ProviderError } from "./binance";
import { ssiFcConfigured, getSsiAccessToken, ssiToday } from "./ssi-fcdata";
import type { DerivativeQuote, OhlcvBar } from "../types";
import {
  fetchPublicVnDerivativeQuote,
  fetchPublicVnDerivativeQuotes,
  fetchPublicVnDerivativeOhlcv,
} from "./public-vn-derivatives";

/**
 * HNX derivatives market-data adapter.
 * Priority: SSI FastConnect → DERIVATIVES_QUOTE_URL → public VNDIRECT dchart.
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
  return res;
}

export async function fetchSsiDerivativeQuote(symbol: string): Promise<DerivativeQuote | null> {
  if (!ssiFcConfigured()) return null;
  try {
    const body = await ssiGet<SsiEnvelope<SsiPriceRow[]>>("/api/v2/Market/DailyStockPrice", {
      Symbol: symbol,
      symbol,
      Market: "DER",
      market: "DER",
      pageIndex: 1,
      pageSize: 10,
      FromDate: ssiToday(),
      fromDate: ssiToday(),
      ToDate: ssiToday(),
      toDate: ssiToday(),
    });
    const rows = Array.isArray(body?.data) ? body.data : [];
    for (const r of rows) {
      const q = mapRowToQuote(symbol, r, "ssi-fcdata-der");
      if (q) return q;
    }
  } catch {
    return null;
  }
  return null;
}

export async function fetchExternalDerivativeQuote(
  symbol: string,
): Promise<DerivativeQuote | null> {
  const template = process.env.DERIVATIVES_QUOTE_URL?.trim();
  if (!template) return null;
  const url = template.replace("{symbol}", encodeURIComponent(symbol));
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    const key = process.env.DERIVATIVES_QUOTE_API_KEY?.trim();
    if (key) headers.Authorization = `Bearer ${key}`;
    const data = await httpJson<Record<string, unknown>>(url, {
      provider: "derivatives-external",
      timeoutMs: 8_000,
      retries: 1,
      headers,
    });
    return mapRowToQuote(symbol, data, "derivatives-external");
  } catch {
    return null;
  }
}

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
  try {
    const pub = await fetchPublicVnDerivativeQuote(sym);
    if (pub) return pub;
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
  const missing = uniq.filter((s) => !out.has(s));
  if (missing.length) {
    try {
      const pub = await fetchPublicVnDerivativeQuotes(missing);
      for (const [k, v] of pub) out.set(k, v);
    } catch {
      /* soft */
    }
  }
  return out;
}

export function derivativesLiveConfigured(): boolean {
  return true;
}

export function derivativesPaidFeedConfigured(): boolean {
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
        pageIndex: 1,
        pageSize: limit,
      });
      const rows = Array.isArray(body?.data) ? body.data : [];
      const bars: OhlcvBar[] = [];
      for (const r of rows) {
        const close = num(r.Close) ?? num(r.close);
        if (close == null) continue;
        let time = Date.now();
        const td = r.TradingDate ?? r.tradingDate ?? r.Date ?? r.date;
        if (typeof td === "string") {
          const m = td.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          if (m) {
            time = new Date(
              `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T15:00:00+07:00`,
            ).getTime();
          } else {
            const p = Date.parse(td);
            if (Number.isFinite(p)) time = p;
          }
        }
        bars.push({
          time,
          open: num(r.Open) ?? num(r.open) ?? close,
          high: num(r.High) ?? num(r.high) ?? close,
          low: num(r.Low) ?? num(r.low) ?? close,
          close,
          volume: num(r.Volume) ?? num(r.volume),
        });
      }
      if (bars.length) return bars.sort((a, b) => a.time - b.time);
    } catch {
      /* fall through */
    }
  }

  const ohlcvUrl = process.env.DERIVATIVES_OHLCV_URL?.trim();
  if (ohlcvUrl) {
    try {
      const url = ohlcvUrl.replace("{symbol}", encodeURIComponent(sym));
      const data = await httpJson<{ bars?: OhlcvBar[] } | OhlcvBar[]>(url, {
        provider: "derivatives-ohlcv-external",
        timeoutMs: 10_000,
        retries: 1,
      });
      const bars = Array.isArray(data) ? data : data?.bars;
      if (bars?.length) return bars;
    } catch {
      /* soft */
    }
  }

  try {
    const pubBars = await fetchPublicVnDerivativeOhlcv(sym, limit);
    if (pubBars.length) return pubBars;
  } catch {
    /* soft */
  }
  return [];
}
