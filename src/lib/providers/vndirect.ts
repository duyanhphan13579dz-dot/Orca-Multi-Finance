import "server-only";
import { httpJson } from "../http";
import type { IndexQuote, OhlcvBar, Quote } from "../types";
import { ProviderError } from "./binance";
import { env } from "../env";

export const VNDIRECT = "vndirect";

const base = () => env.vndirectBaseUrl;

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
  advances?: number;
  declines?: number;
  noChange?: number;
  noTrade?: number;
  accumulatedVal?: number;
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

export async function getVndUniverse(): Promise<
  { symbol: string; name: string | null; exchange: string | null; industry: string | null }[]
> {
  const payload = await vndGet<Page<VndStockMeta>>("/v4/stocks?q=type:STOCK~status:LISTED&size=3000&page=1", 20_000);
  const rows = payload.data ?? [];
  return rows
    .map((r) => {
      const symbol = String(r.code ?? "").toUpperCase();
      if (!symbol) return null;
      return {
        symbol,
        name: r.companyName ?? r.companyNameEng ?? null,
        exchange: r.floor ?? null,
        industry: r.industryName ?? null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
}

export async function getVndLatestSessionDate(): Promise<string> {
  const payload = await vndGet<Page<{ date?: string }>>("/v4/stock_prices?size=1&sort=date:desc", 10_000);
  const d = payload.data?.[0]?.date;
  if (!d) throw new ProviderError("vndirect: no session date", VNDIRECT);
  return String(d).slice(0, 10);
}

export async function getVndIndices(): Promise<{ items: IndexQuote[]; sourceTs: number | null }> {
  const codes = ["VNINDEX", "VN30", "HNX", "HNX30", "UPCOM"];
  const items: IndexQuote[] = [];
  let newest: number | null = null;
  for (const code of codes) {
    try {
      const payload = await vndGet<Page<VndPriceRow>>(
        `/v4/vnmarket_prices?q=code:${code}&size=1&sort=date:desc`,
        10_000,
      );
      const r = payload.data?.[0];
      if (!r?.close) continue;
      const t = r.date ? Date.parse(`${r.date}T15:00:00+07:00`) : null;
      if (t != null && Number.isFinite(t) && (newest == null || t > newest)) newest = t;
      items.push({
        code,
        name: code,
        value: r.close,
        change: num(r.change) ?? 0,
        changePercent: num(r.changePercent) ?? num(r.changeRatio) ?? num(r.pctChange) ?? 0,
        volume: num(r.nmVolume),
        updatedAt: r.date ?? null,
      });
    } catch {
      /* skip */
    }
  }
  if (!items.length) throw new ProviderError("vndirect: empty indices", VNDIRECT);
  return { items, sourceTs: newest };
}

export async function getVndMarketQuotes(
  sessionDate?: string,
): Promise<{ quotes: Quote[]; sourceTs: number | null; sessionDate: string }> {
  const date = sessionDate ?? (await getVndLatestSessionDate());
  const pageSize = 500;
  let page = 1;
  let totalPages = 1;
  const quotes: Quote[] = [];
  let newest: number | null = null;

  while (page <= totalPages && page <= 12) {
    const payload = await vndGet<Page<VndPriceRow>>(
      `/v4/stock_prices?q=date:${date}~type:STOCK&size=${pageSize}&page=${page}`,
      20_000,
    );
    const data = payload.data ?? [];
    totalPages = Math.max(1, Number(payload.totalPages) || 1);
    for (const r of data) {
      const symbol = String(r.code ?? "").toUpperCase();
      const price = num(r.close);
      if (!symbol || price == null || price <= 0) continue;
      const t = r.date ? Date.parse(`${r.date}T15:00:00+07:00`) : null;
      if (t != null && Number.isFinite(t) && (newest == null || t > newest)) newest = t;
      quotes.push({
        symbol,
        assetClass: "stock",
        price,
        change: num(r.change),
        changePercent: num(r.changePercent) ?? num(r.changeRatio) ?? num(r.pctChange),
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
    if (!data.length) break;
    page += 1;
  }

  if (!quotes.length) throw new ProviderError("vndirect: empty market quotes", VNDIRECT);
  return { quotes, sourceTs: newest, sessionDate: date };
}

export async function getVndQuotes(symbols: string[]): Promise<{ quotes: Quote[]; sourceTs: number | null }> {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))].slice(0, 40);
  if (!uniq.length) return { quotes: [], sourceTs: null };
  const date = await getVndLatestSessionDate();
  const quotes: Quote[] = [];
  let newest: number | null = null;
  const results = await Promise.allSettled(
    uniq.map((s) =>
      vndGet<Page<VndPriceRow>>(`/v4/stock_prices?q=code:${s}~date:${date}&size=1&sort=date:desc`, 10_000),
    ),
  );
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const row = r.value.data?.[0];
    if (!row) continue;
    const symbol = String(row.code ?? "").toUpperCase();
    const price = num(row.close);
    if (!symbol || price == null) continue;
    const t = row.date ? Date.parse(`${row.date}T15:00:00+07:00`) : null;
    if (t != null && Number.isFinite(t) && (newest == null || t > newest)) newest = t;
    quotes.push({
      symbol,
      assetClass: "stock",
      price,
      change: num(row.change),
      changePercent: num(row.changePercent) ?? num(row.changeRatio) ?? num(row.pctChange),
      open: num(row.open),
      high: num(row.high),
      low: num(row.low),
      volume: num(row.nmVolume),
      quoteVolume: num(row.nmValue),
      referencePrice: num(row.basicPrice),
      ceilingPrice: num(row.ceilingPrice),
      floorPrice: num(row.floorPrice),
      updatedAt: row.date ?? null,
    });
  }
  if (!quotes.length) throw new ProviderError("vndirect: empty quotes batch", VNDIRECT);
  return { quotes, sourceTs: newest };
}

export async function getVndOhlcv(symbol: string, size = 250): Promise<OhlcvBar[]> {
  const payload = await vndGet<Page<VndPriceRow>>(
    `/v4/stock_prices?q=code:${symbol.toUpperCase()}&size=${Math.min(size, 1500)}&sort=date:asc`,
    18_000,
  );
  const rows = payload.data ?? [];
  const bars: OhlcvBar[] = [];
  for (const r of rows) {
    const t = r.date ? Date.parse(`${r.date}T15:00:00+07:00`) : NaN;
    const o = num(r.open);
    const h = num(r.high);
    const l = num(r.low);
    const c = num(r.close);
    if (!Number.isFinite(t) || o == null || h == null || l == null || c == null) continue;
    bars.push({ time: t, open: o, high: h, low: l, close: c, volume: num(r.nmVolume) ?? 0 });
  }
  if (!bars.length) throw new ProviderError(`vndirect: empty ohlcv ${symbol}`, VNDIRECT);
  return bars;
}

export function vndIndexCode(code: string): string {
  const c = code.toUpperCase();
  if (c === "VNINDEX" || c === "VN-INDEX") return "VNINDEX";
  if (c === "HNXINDEX" || c === "HNX-INDEX") return "HNX";
  return c;
}

export function isVnIndexSymbol(symbol: string): boolean {
  const c = symbol.toUpperCase();
  return ["VNINDEX", "VN30", "HNX", "HNX30", "UPCOM", "VN100", "HNXINDEX"].includes(c);
}

export async function getVndIndexOhlcv(code: string, size = 250): Promise<OhlcvBar[]> {
  const idx = vndIndexCode(code);
  const payload = await vndGet<Page<VndPriceRow>>(
    `/v4/vnmarket_prices?q=code:${idx}&size=${Math.min(size, 1500)}&sort=date:asc`,
    18_000,
  );
  const bars: OhlcvBar[] = [];
  for (const r of payload.data ?? []) {
    const t = r.date ? Date.parse(`${r.date}T15:00:00+07:00`) : NaN;
    const o = num(r.open) ?? num(r.close);
    const h = num(r.high) ?? o;
    const l = num(r.low) ?? o;
    const c = num(r.close);
    if (!Number.isFinite(t) || o == null || h == null || l == null || c == null) continue;
    bars.push({ time: t, open: o, high: h, low: l, close: c, volume: num(r.nmVolume) ?? 0 });
  }
  if (!bars.length) throw new ProviderError(`vndirect: empty index ohlcv ${code}`, VNDIRECT);
  return bars;
}

export type VndIndexSessionStats = {
  code: string;
  advances: number;
  declines: number;
  unchanged: number;
  value: number | null;
  sourceTs: number | null;
};

export async function getVndIndexSessionStats(code: string): Promise<VndIndexSessionStats> {
  const idx = vndIndexCode(code);
  const payload = await vndGet<Page<VndPriceRow>>(
    `/v4/vnmarket_prices?q=code:${idx}&size=1&sort=date:desc`,
    10_000,
  );
  const r = payload.data?.[0];
  if (!r) throw new ProviderError(`vndirect: no index stats ${code}`, VNDIRECT);
  const t = r.date ? Date.parse(`${r.date}T15:00:00+07:00`) : null;
  return {
    code: idx,
    advances: num(r.advances) ?? 0,
    declines: num(r.declines) ?? 0,
    unchanged: num(r.noChange) ?? 0,
    value: num(r.accumulatedVal) ?? num(r.nmValue),
    sourceTs: t != null && Number.isFinite(t) ? t : null,
  };
}

export type VndForeignFlowRow = {
  symbol: string;
  buyVal: number;
  sellVal: number;
  netVal: number;
  floor: string | null;
};

export type VndForeignFlowSummary = {
  sessionDate: string;
  buyVal: number;
  sellVal: number;
  netVal: number;
  stockCount: number;
  topNetBuy: VndForeignFlowRow[];
  topNetSell: VndForeignFlowRow[];
  sourceTs: number | null;
};

/** Aggregate foreign investor buy/sell for listed STOCK on a session date. */
export async function getVndForeignFlow(sessionDate?: string): Promise<VndForeignFlowSummary> {
  const date = sessionDate ?? (await getVndLatestSessionDate());
  const pageSize = 200;
  let page = 1;
  let totalPages = 1;
  let buyVal = 0;
  let sellVal = 0;
  let netVal = 0;
  let stockCount = 0;
  const rows: VndForeignFlowRow[] = [];

  while (page <= totalPages && page <= 20) {
    const payload = await vndGet<
      Page<{
        code?: string;
        type?: string;
        floor?: string;
        buyVal?: number;
        sellVal?: number;
        netVal?: number;
        tradingDate?: string;
      }>
    >(`/v4/foreigns?q=tradingDate:${date}~type:STOCK&size=${pageSize}&page=${page}`, 18_000);
    const data = payload.data ?? [];
    totalPages = Math.max(1, Number(payload.totalPages) || 1);
    for (const r of data) {
      if ((r.type ?? "STOCK").toUpperCase() !== "STOCK") continue;
      const symbol = String(r.code ?? "").toUpperCase();
      if (!symbol) continue;
      const bv = num(r.buyVal) ?? 0;
      const sv = num(r.sellVal) ?? 0;
      const nv = num(r.netVal) ?? bv - sv;
      buyVal += bv;
      sellVal += sv;
      netVal += nv;
      stockCount += 1;
      if (Math.abs(nv) > 0) {
        rows.push({ symbol, buyVal: bv, sellVal: sv, netVal: nv, floor: r.floor ?? null });
      }
    }
    if (!data.length) break;
    page += 1;
  }

  rows.sort((a, b) => b.netVal - a.netVal);
  const topNetBuy = rows.filter((r) => r.netVal > 0).slice(0, 8);
  const topNetSell = [...rows].filter((r) => r.netVal < 0).sort((a, b) => a.netVal - b.netVal).slice(0, 8);
  const ts = Date.parse(`${date}T15:00:00+07:00`);

  return {
    sessionDate: date,
    buyVal,
    sellVal,
    netVal,
    stockCount,
    topNetBuy,
    topNetSell,
    sourceTs: Number.isFinite(ts) ? ts : null,
  };
}

async function resolveEtfSessionDate(preferred?: string): Promise<string> {
  if (preferred) return preferred;
  try {
    return await getVndLatestSessionDate();
  } catch {
    /* fall through */
  }
  const probe = await vndGet<Page<{ tradingDate?: string }>>(
    `/v4/foreigns?q=type:ETF&size=1&sort=tradingDate:desc`,
    12_000,
  );
  const d = probe.data?.[0]?.tradingDate;
  if (!d) throw new ProviderError("vndirect: no ETF foreign session date", VNDIRECT);
  return String(d).slice(0, 10);
}

/** Aggregate foreign investor flow on listed ETFs (VNDirect foreigns type:ETF). */
export async function getVndEtfFlow(sessionDate?: string): Promise<VndForeignFlowSummary> {
  let date = await resolveEtfSessionDate(sessionDate);

  const load = async (d: string) => {
    const pageSize = 100;
    let page = 1;
    let totalPages = 1;
    let buyVal = 0;
    let sellVal = 0;
    let netVal = 0;
    let stockCount = 0;
    const rows: VndForeignFlowRow[] = [];

    while (page <= totalPages && page <= 10) {
      const payload = await vndGet<
        Page<{
          code?: string;
          type?: string;
          floor?: string;
          buyVal?: number;
          sellVal?: number;
          netVal?: number;
          tradingDate?: string;
        }>
      >(`/v4/foreigns?q=tradingDate:${d}~type:ETF&size=${pageSize}&page=${page}`, 18_000);
      const data = payload.data ?? [];
      totalPages = Math.max(1, Number(payload.totalPages) || 1);
      for (const r of data) {
        if ((r.type ?? "ETF").toUpperCase() !== "ETF") continue;
        const symbol = String(r.code ?? "").toUpperCase();
        if (!symbol) continue;
        const bv = num(r.buyVal) ?? 0;
        const sv = num(r.sellVal) ?? 0;
        const nv = num(r.netVal) ?? bv - sv;
        buyVal += bv;
        sellVal += sv;
        netVal += nv;
        stockCount += 1;
        if (Math.abs(nv) > 0) {
          rows.push({ symbol, buyVal: bv, sellVal: sv, netVal: nv, floor: r.floor ?? null });
        }
      }
      if (!data.length) break;
      page += 1;
    }
    return { buyVal, sellVal, netVal, stockCount, rows };
  };

  let pack = await load(date);
  if (pack.stockCount === 0 || (pack.buyVal === 0 && pack.sellVal === 0)) {
    const probe = await vndGet<Page<{ tradingDate?: string }>>(
      `/v4/foreigns?q=type:ETF&size=1&sort=tradingDate:desc`,
      12_000,
    );
    const alt = probe.data?.[0]?.tradingDate ? String(probe.data[0].tradingDate).slice(0, 10) : null;
    if (alt && alt !== date) {
      date = alt;
      pack = await load(date);
    }
  }

  if (pack.stockCount === 0 && pack.buyVal === 0 && pack.sellVal === 0) {
    throw new ProviderError(`vndirect: empty ETF flow ${date}`, VNDIRECT);
  }

  pack.rows.sort((a, b) => b.netVal - a.netVal);
  const topNetBuy = pack.rows.filter((r) => r.netVal > 0).slice(0, 8);
  const topNetSell = [...pack.rows].filter((r) => r.netVal < 0).sort((a, b) => a.netVal - b.netVal).slice(0, 8);
  const ts = Date.parse(`${date}T15:00:00+07:00`);

  return {
    sessionDate: date,
    buyVal: pack.buyVal,
    sellVal: pack.sellVal,
    netVal: pack.netVal,
    stockCount: pack.stockCount,
    topNetBuy,
    topNetSell,
    sourceTs: Number.isFinite(ts) ? ts : null,
  };
}
