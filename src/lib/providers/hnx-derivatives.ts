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
import {
  fetchEntradeDerivativeQuote,
  fetchEntradeDerivativeQuotes,
  fetchEntradeDerivativeOhlcv,
} from "./entrade-derivatives";
import {
  dnseConfigured,
  fetchDnseDerivativeQuote,
  fetchDnseDerivativeQuotes,
} from "./dnse-derivatives";
import {
  tcbsConfigured,
  fetchTcbsDerivativeQuote,
  fetchTcbsDerivativeQuotes,
} from "./tcbs-derivatives";

/** Cascade: SSI → DNSE → TCBS → Entrade → external → VNDIRECT. */

export const HNX_DERIVATIVES = "hnx-derivatives";

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(String(v).replace(/,/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};

function mapRowToQuote(
  symbol: string,
  r: Record<string, unknown>,
  source: string,
): DerivativeQuote | null {
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
  return {
    symbol: symbol.toUpperCase(),
    last,
    change: num(r.Change) ?? num(r.change),
    changePercent: num(r.PerChange) ?? num(r.changePercent),
    open: num(r.Open) ?? num(r.open),
    high: num(r.High) ?? num(r.high),
    low: num(r.Low) ?? num(r.low),
    volume: num(r.Volume) ?? num(r.volume),
    openInterest: num(r.OpenInterest) ?? num(r.openInterest),
    settlement: num(r.SettlementPrice),
    mark: null,
    ceiling: num(r.CeilingPrice),
    floor: num(r.FloorPrice),
    reference: num(r.RefPrice),
    updatedAt: new Date().toISOString(),
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
    if (!data.ok || !data.data) return null;
    return mapRowToQuote(symbol, data.data, "derivatives-external");
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
    if (dnseConfigured()) {
      const dnse = await fetchDnseDerivativeQuote(sym);
      if (dnse) return dnse;
    }
  } catch {
    /* continue */
  }
  try {
    if (tcbsConfigured()) {
      const tcbs = await fetchTcbsDerivativeQuote(sym);
      if (tcbs) return tcbs;
    }
  } catch {
    /* continue */
  }
  try {
    const ent = await fetchEntradeDerivativeQuote(sym);
    if (ent) return ent;
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
  if (dnseConfigured()) {
    try {
      const missing0 = uniq.filter((s) => !out.has(s));
      if (missing0.length) {
        const m = await fetchDnseDerivativeQuotes(missing0);
        for (const [k, v] of m) out.set(k, v);
      }
    } catch {
      /* soft */
    }
  }
  if (tcbsConfigured()) {
    try {
      const missing0 = uniq.filter((s) => !out.has(s));
      if (missing0.length) {
        const m = await fetchTcbsDerivativeQuotes(missing0);
        for (const [k, v] of m) out.set(k, v);
      }
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
  let missing = uniq.filter((s) => !out.has(s));
  if (missing.length) {
    try {
      const ent = await fetchEntradeDerivativeQuotes(missing);
      for (const [k, v] of ent) out.set(k, v);
    } catch {
      /* soft */
    }
  }
  missing = uniq.filter((s) => !out.has(s));
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
  return (
    ssiFcConfigured() ||
    dnseConfigured() ||
    tcbsConfigured() ||
    Boolean(process.env.DERIVATIVES_QUOTE_URL?.trim())
  );
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
      if (data.ok && data.data) {
        const bars = Array.isArray(data.data) ? data.data : data.data.bars;
        if (bars?.length) return bars;
      }
    } catch {
      /* soft */
    }
  }

  try {
    const entBars = await fetchEntradeDerivativeOhlcv(sym, limit);
    if (entBars.length) return entBars;
  } catch {
    /* soft */
  }
  try {
    const pubBars = await fetchPublicVnDerivativeOhlcv(sym, limit);
    if (pubBars.length) return pubBars;
  } catch {
    /* soft */
  }
  return [];
}
