import "server-only";
import { httpJson } from "../http";
import { ssiFcConfigured } from "./ssi-fcdata";
import {
  fetchSsiDerQuote,
  fetchSsiDerQuotes,
  fetchSsiDerOhlcv,
} from "./ssi-derivatives";
import type { DerivativeQuote, OhlcvBar } from "../types";
import {
  fetchPublicVnDerivativeQuote,
  fetchPublicVnDerivativeQuotes,
  fetchPublicVnDerivativeOhlcv,
} from "./public-vn-derivatives";

/**
 * HNX derivatives market-data adapter.
 * Priority: SSI FastConnect DER → DERIVATIVES_QUOTE_URL → public VNDIRECT dchart.
 */

export const HNX_DERIVATIVES = "hnx-derivatives";

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(String(v).replace(/,/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
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
    change: num(r.Change) ?? num(r.change) ?? num(r.PriceChange),
    changePercent:
      num(r.PerChange) ??
      num(r.perChange) ??
      num(r.ChangePercent) ??
      num(r.changePercent),
    open: num(r.Open) ?? num(r.open),
    high: num(r.High) ?? num(r.high),
    low: num(r.Low) ?? num(r.low),
    volume: num(r.Volume) ?? num(r.volume) ?? num(r.TotalMatchVolume),
    openInterest: num(r.OpenInterest) ?? num(r.openInterest) ?? num(r.OI),
    settlement: num(r.SettlementPrice) ?? num(r.settlementPrice),
    mark: null,
    ceiling: num(r.CeilingPrice) ?? num(r.ceilingPrice),
    floor: num(r.FloorPrice) ?? num(r.floorPrice),
    reference: num(r.RefPrice) ?? num(r.ReferencePrice),
    updatedAt,
    source,
  };
}

export async function fetchSsiDerivativeQuote(symbol: string): Promise<DerivativeQuote | null> {
  if (!ssiFcConfigured()) return null;
  try {
    return await fetchSsiDerQuote(symbol);
  } catch {
    return null;
  }
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
  if (ssiFcConfigured()) {
    try {
      const ssiMap = await fetchSsiDerQuotes(uniq);
      for (const [k, v] of ssiMap) out.set(k, v);
    } catch {
      /* soft */
    }
  }
  await Promise.all(
    uniq.filter((s) => !out.has(s)).map(async (sym) => {
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

export function derivativesSsiConfigured(): boolean {
  return ssiFcConfigured();
}

export async function fetchDerivativeOhlcv(
  symbol: string,
  days = 60,
): Promise<OhlcvBar[]> {
  const sym = symbol.toUpperCase();
  const limit = Math.min(Math.max(days, 5), 250);

  if (ssiFcConfigured()) {
    try {
      const derBars = await fetchSsiDerOhlcv(sym, limit);
      if (derBars.length) return derBars;
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
