import "server-only";
import { httpJson } from "../http";
import type { DerivativeQuote, OhlcvBar } from "../types";

/**
 * Entrade / DNSE public chart API (no key) — parallel to SSI + VNDIRECT.
 * https://services.entrade.com.vn/chart-api/v2/ohlcs/derivative
 */

export const ENTRADE_DER = "entrade-derivative-public";

type EntradeHist = {
  t?: number[];
  o?: number[];
  h?: number[];
  l?: number[];
  c?: number[];
  v?: number[];
};

async function fetchHist(
  symbol: string,
  resolution: string,
  fromSec: number,
  toSec: number,
): Promise<EntradeHist | null> {
  const url =
    `https://services.entrade.com.vn/chart-api/v2/ohlcs/derivative` +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&resolution=${encodeURIComponent(resolution)}` +
    `&from=${fromSec}&to=${toSec}`;
  try {
    const data = await httpJson<EntradeHist>(url, {
      provider: ENTRADE_DER,
      timeoutMs: 8_000,
      retries: 1,
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; OrcaFinance/1.0)",
      },
    });
    if (!data?.c?.length) return null;
    return data;
  } catch {
    return null;
  }
}

function toQuote(symbol: string, hist: EntradeHist): DerivativeQuote | null {
  const n = hist.c!.length;
  const last = hist.c![n - 1];
  if (last == null || !Number.isFinite(last) || last <= 0) return null;
  const prev = n >= 2 ? hist.c![n - 2] : null;
  const change = prev != null ? last - prev : null;
  const changePercent =
    prev != null && prev !== 0 ? ((last - prev) / prev) * 100 : null;
  const ts = hist.t?.[n - 1];
  return {
    symbol: symbol.toUpperCase(),
    last,
    change,
    changePercent,
    open: hist.o?.[n - 1] ?? null,
    high: hist.h?.[n - 1] ?? null,
    low: hist.l?.[n - 1] ?? null,
    volume: hist.v?.[n - 1] ?? null,
    openInterest: null,
    settlement: null,
    mark: null,
    ceiling: null,
    floor: null,
    reference: prev,
    updatedAt: ts != null ? new Date(ts * 1000).toISOString() : new Date().toISOString(),
    source: ENTRADE_DER,
  };
}

export async function fetchEntradeDerivativeQuote(
  symbol: string,
): Promise<DerivativeQuote | null> {
  const sym = symbol.toUpperCase();
  const to = Math.floor(Date.now() / 1000);
  let hist = await fetchHist(sym, "5", to - 86400 * 2, to);
  if (!hist?.c?.length) {
    hist = await fetchHist(sym, "1D", to - 86400 * 45, to);
  }
  if (!hist) return null;
  return toQuote(sym, hist);
}

export async function fetchEntradeDerivativeQuotes(
  symbols: string[],
): Promise<Map<string, DerivativeQuote>> {
  const out = new Map<string, DerivativeQuote>();
  await Promise.all(
    [...new Set(symbols.map((s) => s.toUpperCase()))].map(async (sym) => {
      const q = await fetchEntradeDerivativeQuote(sym);
      if (q) out.set(sym, q);
    }),
  );
  return out;
}

export async function fetchEntradeDerivativeOhlcv(
  symbol: string,
  days = 60,
): Promise<OhlcvBar[]> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 86400 * Math.max(days, 5);
  const hist = await fetchHist(symbol.toUpperCase(), "1D", from, to);
  if (!hist?.t?.length || !hist.c?.length) return [];
  const bars: OhlcvBar[] = [];
  for (let i = 0; i < hist.t.length; i++) {
    const c = hist.c[i];
    if (c == null || !Number.isFinite(c)) continue;
    bars.push({
      time: hist.t[i] * 1000,
      open: hist.o?.[i] ?? c,
      high: hist.h?.[i] ?? c,
      low: hist.l?.[i] ?? c,
      close: c,
      volume: hist.v?.[i] ?? null,
    });
  }
  return bars;
}
