import "server-only";
import { httpJson } from "../http";
import type { DerivativeQuote, OhlcvBar } from "../types";

/**
 * Public VN futures quotes (no API key).
 * Source: VNDIRECT dchart history API — last completed bar as quote.
 */

export const PUBLIC_VN_DER = "vndirect-dchart-public";

const UA =
  "Mozilla/5.0 (compatible; OrcaFinance/1.0; +https://github.com/duyanhphan13579dz-dot/Orca-Multi-Finance)";

type DchartHist = {
  s?: string;
  t?: number[];
  o?: number[];
  h?: number[];
  l?: number[];
  c?: number[];
  v?: number[];
};

async function fetchDchart(
  symbol: string,
  resolution: string,
  fromSec: number,
  toSec: number,
): Promise<DchartHist | null> {
  const url =
    `https://dchart-api.vndirect.com.vn/dchart/history` +
    `?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}` +
    `&from=${fromSec}&to=${toSec}`;
  try {
    const data = await httpJson<DchartHist>(url, {
      provider: PUBLIC_VN_DER,
      timeoutMs: 8_000,
      retries: 1,
      headers: {
        Accept: "application/json",
        "User-Agent": UA,
        Referer: "https://dchart.vndirect.com.vn/",
      },
    });
    if (!data || data.s === "no_data" || !data.c?.length) return null;
    return data;
  } catch {
    return null;
  }
}

function histToQuote(symbol: string, hist: DchartHist): DerivativeQuote | null {
  const n = hist.c!.length;
  if (n < 1) return null;
  const last = hist.c![n - 1];
  if (last == null || !Number.isFinite(last) || last <= 0) return null;
  const prev = n >= 2 ? hist.c![n - 2] : null;
  const change = prev != null ? last - prev : null;
  const changePercent =
    prev != null && prev !== 0 ? ((last - prev) / prev) * 100 : null;
  const ts = hist.t?.[n - 1];
  const updatedAt =
    ts != null ? new Date(ts * 1000).toISOString() : new Date().toISOString();

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
    updatedAt,
    source: PUBLIC_VN_DER,
  };
}

const CONTINUOUS = ["VN30F1M", "VN30F2M", "VN30F3M", "VN30F1Q"] as const;

export async function fetchPublicVnDerivativeQuote(
  symbol: string,
): Promise<DerivativeQuote | null> {
  const sym = symbol.toUpperCase();
  const to = Math.floor(Date.now() / 1000);
  const from = to - 86400 * 45;
  let hist = await fetchDchart(sym, "D", from, to);
  if (!hist?.c?.length) {
    hist = await fetchDchart(sym, "60", to - 86400 * 7, to);
  }
  if (!hist) return null;
  return histToQuote(sym, hist);
}

export async function fetchPublicVnDerivativeQuotes(
  symbols: string[],
): Promise<Map<string, DerivativeQuote>> {
  const out = new Map<string, DerivativeQuote>();
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()))];
  const ordered = [
    ...CONTINUOUS.filter((c) => uniq.includes(c)),
    ...uniq.filter((u) => !(CONTINUOUS as readonly string[]).includes(u)),
  ];
  await Promise.all(
    ordered.map(async (sym) => {
      const q = await fetchPublicVnDerivativeQuote(sym);
      if (q) out.set(sym, q);
    }),
  );
  return out;
}

export async function fetchPublicVnDerivativeOhlcv(
  symbol: string,
  days = 60,
): Promise<OhlcvBar[]> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 86400 * Math.max(days, 5);
  const hist = await fetchDchart(symbol.toUpperCase(), "D", from, to);
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

export async function fetchPublicVn30Spot(): Promise<{
  price: number | null;
  source: string | null;
  ts: number | null;
}> {
  const to = Math.floor(Date.now() / 1000);
  const hist = await fetchDchart("VN30", "D", to - 86400 * 10, to);
  if (!hist?.c?.length) return { price: null, source: null, ts: null };
  const n = hist.c.length;
  const price = hist.c[n - 1];
  const ts = hist.t?.[n - 1] ? hist.t[n - 1] * 1000 : Date.now();
  return {
    price: price != null && price > 0 ? price : null,
    source: PUBLIC_VN_DER,
    ts,
  };
}
