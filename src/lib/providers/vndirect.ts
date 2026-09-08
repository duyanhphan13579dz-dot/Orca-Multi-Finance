import "server-only";
import { httpJson } from "../http";
import type { IndexQuote, OhlcvBar, Quote } from "../types";
import { ProviderError } from "./binance";

/**
 * VNDIRECT provider — primary free source for full VN equity market board
 * (universe + indices + daily prices). Also secondary validation for VNStock.
 * Host: api-finfo.vndirect.com.vn (public finfo API).
 */

export const VNDIRECT = "vndirect";

const base = () =>
  (process.env.VNDIRECT_BASE_URL ?? "https://api-finfo.vndirect.com.vn").replace(/\/$/, "");

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

type VndPriceRow = {
  code?: string;
  date?: string;
  time?: string;
  floor?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  nmVolume?: number;
  nmValue?: number;
  change?: number;
  changeRatio?: number;
  changePercent?: number;
  pctChange?: number;
  basicPrice?: number;
  ceilingPrice?: number;
  floorPrice?: number;
  average?: number;
};

type VndStockMeta = {
  code?: string;
  companyName?: string;
  companyNameEng?: string;
  floor?: string;
  industryName?: string;
  status?: string;
  type?: string;
};

type Page<T> = {
  data?: T[];
  totalElements?: number;
  totalPages?: number;
  size?: number;
  currentPage?: number;
};

async function vndGet<T>(path: string, timeoutMs = 12_000): Promise<T> {
  const res = await httpJson<T>(`${base()}${path}`, {
    provider: VNDIRECT,
    timeoutMs,
    retries: 1,
    headers: { Accept: "application/json" },
  });
  if (!res.ok || res.data == null) throw new ProviderError(`vndirect: ${res.error ?? "unreachable"}`, VNDIRECT);
  return res.data;
}

/** Listed equity universe (HOSE / HNX / UPCOM). */
export async function getVndUniverse(): Promise<
  { symbol: string; name: string | null; exchange: string | null; industry: string | null }[]
> {
  const pageSize = 200;
  const out: { symbol: string; name: string | null; exchange: string | null; industry: string | null }[] = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages && page <= 20) {
    const payload = await vndGet<Page<VndStockMeta>>(
      `/v4/stocks?q=type:stock~status:listed&size=${pageSize}&page=${page}&fields=code,companyName,floor,industryName,status,type`,
    );
    const rows = payload.data ?? [];
    totalPages = Math.max(1, Number(payload.totalPages) || 1);
    for (const r of rows) {
      const symbol = String(r.code ?? "").toUpperCase();
      if (!symbol) continue;
      out.push({
        symbol,
        name: r.companyName ?? r.companyNameEng ?? null,
        exchange: (r.floor ?? null)?.toUpperCase() ?? null,
        industry: r.industryName ?? null,
      });
    }
    if (!rows.length) break;
    page += 1;
  }
  if (!out.length) throw new ProviderError("vndirect: empty universe", VNDIRECT);
  return out;
}

/** Resolve latest trading session date from VNINDEX. */
export async function getVndLatestSessionDate(): Promise<string> {
  const payload = await vndGet<Page<{ date?: string; code?: string }>>(
    `/v4/vnmarket_prices?q=code:VNINDEX&size=1&sort=date:desc`,
  );
  const d = payload.data?.[0]?.date;
  if (!d) throw new ProviderError("vndirect: cannot resolve session date", VNDIRECT);
  return d.slice(0, 10);
}

/** Market indices (VNINDEX, VN30, HNX, UPCOM, …). */
export async function getVndIndices(): Promise<{ items: IndexQuote[]; sourceTs: number | null }> {
  const date = await getVndLatestSessionDate();
  const codes = ["VNINDEX", "VN30", "HNX", "UPCOM", "VN100", "HNX30"];
  const payload = await vndGet<Page<VndPriceRow>>(
    `/v4/vnmarket_prices?q=code:${codes.join(",")}~date:${date}&size=20&sort=code:asc`,
  );
  let newest: number | null = null;
  const items = (payload.data ?? [])
    .map((r): IndexQuote | null => {
      const code = String(r.code ?? "").toUpperCase();
      const value = num(r.close);
      if (!code || value == null) return null;
      const chg = num(r.change);
      const pct = num(r.pctChange) ?? num(r.changePercent) ?? num(r.changeRatio);
      const ts = r.date ? Date.parse(`${r.date}T${r.time ?? "15:00:00"}+07:00`) : null;
      if (ts != null && Number.isFinite(ts) && (newest == null || ts > newest)) newest = ts;
      return {
        code,
        name: code,
        value,
        change: chg ?? 0,
        changePercent: pct ?? 0,
        volume: num(r.nmVolume),
        updatedAt: r.date ?? null,
      };
    })
    .filter((x): x is IndexQuote => x != null);
  if (!items.length) throw new ProviderError("vndirect: empty indices", VNDIRECT);
  return { items, sourceTs: newest };
}

/** Full market board for a session date (all floors), paginated. */
export async function getVndMarketQuotes(
  sessionDate?: string,
): Promise<{ quotes: Quote[]; sourceTs: number | null; sessionDate: string }> {
  const date = sessionDate ?? (await getVndLatestSessionDate());
  const pageSize = 200;
  const quotes: Quote[] = [];
  let page = 1;
  let totalPages = 1;
  let newest: number | null = null;

  while (page <= totalPages && page <= 25) {
    const payload = await vndGet<Page<VndPriceRow>>(
      `/v4/stock_prices?q=date:${date}&size=${pageSize}&page=${page}&sort=code:asc`,
      18_000,
    );
    const rows = payload.data ?? [];
    totalPages = Math.max(1, Number(payload.totalPages) || 1);
    for (const r of rows) {
      const symbol = String(r.code ?? "").toUpperCase();
      const price = num(r.close);
      if (!symbol || price == null || price <= 0) continue;
      const cp =
        num(r.pctChange) != null
          ? num(r.pctChange)
          : num(r.changePercent) != null
            ? num(r.changePercent)
            : num(r.changeRatio) != null
              ? (num(r.changeRatio) as number) * 100
              : null;
      const ts = r.date ? Date.parse(`${r.date}T${r.time ?? "15:00:00"}+07:00`) : null;
      if (ts != null && Number.isFinite(ts) && (newest == null || ts > newest)) newest = ts;
      quotes.push({
        symbol,
        assetClass: "stock",
        price,
        change: num(r.change),
        changePercent: cp,
        open: num(r.open),
        high: num(r.high),
        low: num(r.low),
        volume: num(r.nmVolume),
        quoteVolume: num(r.nmValue),
        referencePrice: num(r.basicPrice),
        ceilingPrice: num(r.ceilingPrice),
        floorPrice: num(r.floorPrice),
        updatedAt: r.date ?? null,
      });
    }
    if (!rows.length) break;
    page += 1;
  }

  if (!quotes.length) throw new ProviderError("vndirect: empty market board", VNDIRECT);
  return { quotes, sourceTs: newest, sessionDate: date };
}

/** latest daily quotes for a list of symbols (validation path) */
export async function getVndQuotes(symbols: string[]): Promise<{ quotes: Quote[]; sourceTs: number | null }> {
  const chunks = symbols.slice(0, 40).map((s) => s.toUpperCase());
  if (!chunks.length) return { quotes: [], sourceTs: null };
  const date = await getVndLatestSessionDate();
  const payload = await vndGet<Page<VndPriceRow>>(
    `/v4/stock_prices?q=code:${chunks.join(",")}~date:${date}&size=${chunks.length}&sort=code:asc`,
  );
  let newest: number | null = null;
  const quotes = (payload.data ?? [])
    .map((r): Quote | null => {
      const symbol = String(r.code ?? "").toUpperCase();
      const price = num(r.close);
      if (!symbol || price == null || price <= 0) return null;
      const tsDate = r.date ? Date.parse(r.date) : null;
      const cp =
        num(r.pctChange) != null
          ? num(r.pctChange)
          : num(r.changeRatio) != null
            ? (num(r.changeRatio) as number) * 100
            : num(r.changePercent);
      if (tsDate != null && (newest == null || tsDate > newest)) newest = tsDate;
      return {
        symbol,
        assetClass: "stock",
        price,
        change: num(r.change),
        changePercent: cp,
        open: num(r.open),
        high: num(r.high),
        low: num(r.low),
        volume: num(r.nmVolume),
        quoteVolume: num(r.nmValue),
        referencePrice: num(r.basicPrice),
        ceilingPrice: num(r.ceilingPrice),
        floorPrice: num(r.floorPrice),
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
      const o = num(r.open);
      const h = num(r.high);
      const l = num(r.low);
      const c = num(r.close);
      if (!Number.isFinite(t) || o == null || h == null || l == null || c == null) return null;
      return { time: t, open: o, high: h, low: l, close: c, volume: num(r.nmVolume) ?? 0 };
    })
    .filter((x): x is OhlcvBar => x !== null)
    .sort((a, b) => a.time - b.time);
  if (!bars.length) throw new ProviderError("vndirect: empty ohlcv", VNDIRECT);
  return bars;
}
