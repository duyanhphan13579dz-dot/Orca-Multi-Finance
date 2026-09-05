import "server-only";
import { env } from "../env";
import { httpJson } from "../http";
import type { OhlcvBar, Quote } from "../types";
import { ProviderError } from "./binance";

/**
 * VNDIRECT provider adapter — secondary + validation source for VN equities
 * (reconciliation layer). Public community endpoints, env-overridable base URL;
 * when VNDirect's gateway blocks the environment, it degrades honestly.
 */

export const VNDIRECT = "vndirect";

const base = () => (process.env.VNDIRECT_BASE_URL ?? "https://finfo-api.vndirect.com.vn").replace(/\/$/, "");

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

type VndPriceRow = {
  code?: string;
  date?: string;
  time?: string;
  open?: number; high?: number; low?: number; close?: number;
  nmVolume?: number; nmValue?: number;
  change?: number; changeRatio?: number; changePercent?: number;
  floor?: string;
};

/** latest daily quotes for a list of symbols (validation path) */
export async function getVndQuotes(symbols: string[]): Promise<{ quotes: Quote[]; sourceTs: number | null }> {
  const chunks = symbols.slice(0, 40);
  const res = await httpJson<{ data?: VndPriceRow[] }>(
    `${base()}/v4/stock_latest?q=code:${chunks.join(",")}&fields=code,date,open,high,low,close,nmVolume,nmValue,change,changeRatio&size=${chunks.length}`,
    { provider: VNDIRECT, timeoutMs: 8_000, retries: 1 },
  );
  if (!res.ok || !res.data?.data) throw new ProviderError(`vndirect: ${res.error ?? "unreachable"}`, VNDIRECT);
  let newest: number | null = null;
  const quotes = res.data.data
    .map((r): Quote | null => {
      const symbol = String(r.code ?? "").toUpperCase();
      const price = num(r.close);
      if (!symbol || price == null || price <= 0) return null;
      const tsDate = r.date ? Date.parse(r.date) : null;
      const cp = num(r.changeRatio) != null ? num(r.changeRatio) : num(r.changePercent);
      if (tsDate != null && (newest == null || tsDate > newest)) newest = tsDate;
      return {
        symbol,
        assetClass: "stock",
        price,
        change: num(r.change),
        changePercent: cp != null ? cp * 100 : null,
        open: num(r.open),
        high: num(r.high),
        low: num(r.low),
        volume: num(r.nmVolume),
        quoteVolume: num(r.nmValue),
        updatedAt: r.date ?? null,
      };
    })
    .filter((x): x is Quote => x !== null);
  if (!quotes.length) throw new ProviderError("vndirect: empty payload", VNDIRECT);
  return { quotes, sourceTs: newest };
}

/** daily OHLCV history (validation + fallback series) */
export async function getVndOhlcv(symbol: string, size = 250): Promise<OhlcvBar[]> {
  const s = encodeURIComponent(symbol.toUpperCase());
  const res = await httpJson<{ data?: VndPriceRow[] }>(
    `${base()}/v4/stock_prices?sort=date:desc&q=code:${s}&size=${size}&fields=code,date,open,high,low,close,nmVolume`,
    { provider: VNDIRECT, timeoutMs: 9_000, retries: 1 },
  );
  if (!res.ok || !res.data?.data) throw new ProviderError(`vndirect: ${res.error ?? "unreachable"}`, VNDIRECT);
  const bars = res.data.data
    .map((r): OhlcvBar | null => {
      const t = r.date ? Date.parse(r.date) : NaN;
      const o = num(r.open); const h = num(r.high); const l = num(r.low); const c = num(r.close);
      if (!Number.isFinite(t) || o == null || h == null || l == null || c == null) return null;
      return { time: t, open: o, high: h, low: l, close: c, volume: num(r.nmVolume) ?? 0 };
    })
    .filter((x): x is OhlcvBar => x !== null)
    .sort((a, b) => a.time - b.time);
  if (!bars.length) throw new ProviderError("vndirect: empty ohlcv", VNDIRECT);
  return bars;
}
