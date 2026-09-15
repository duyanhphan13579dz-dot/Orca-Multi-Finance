import "server-only";
import { httpJson } from "../http";
import type { IndexQuote, OhlcvBar, Quote } from "../types";
import { ProviderError } from "./binance";
import { fetchVndFullUniverse } from "./vndirect-universe";

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
  advances?: number;
  declines?: number;
  noChange?: number;
  noTrade?: number;
  accumulatedVal?: number;
};

type Page<T> = {
  data?: T[];
  totalElements?: number;
  totalPages?: number;
  size?: number;
  currentPage?: number;
};

const VND_HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  Origin: "https://dstock.vndirect.com.vn",
  Referer: "https://dstock.vndirect.com.vn/",
  "X-Requested-With": "XMLHttpRequest",
};

const LAT_RING: { path: string; ms: number; ok: boolean; at: number }[] = [];
function recordVndLatency(path: string, ms: number, ok: boolean) {
  LAT_RING.push({ path: path.split("?")[0] ?? path, ms: Math.round(ms), ok, at: Date.now() });
  if (LAT_RING.length > 200) LAT_RING.shift();
}
export function getVndirectLatencyStats() {
  const now = Date.now();
  const recent = LAT_RING.filter((s) => now - s.at <= 5 * 60_000);
  const ok = recent.filter((s) => s.ok);
  const sorted = ok.map((s) => s.ms).sort((a, b) => a - b);
  const pct = (p: number) =>
    sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]! : null;
  return {
    samples: recent.length,
    windowMs: 5 * 60_000,
    okRate: recent.length ? ok.length / recent.length : 1,
    p50Ms: pct(50),
    p95Ms: pct(95),
    avgMs: ok.length ? Math.round(ok.reduce((a, s) => a + s.ms, 0) / ok.length) : null,
    byPath: [] as { path: string; count: number; avgMs: number; p95Ms: number; okRate: number }[],
    lastErrorAt: recent.filter((s) => !s.ok).at(-1)?.at ?? null,
  };
}

async function vndGet<T>(path: string, timeoutMs = 6_000): Promise<T> {
  const t0 = performance.now();
  const res = await httpJson<T>(`${base()}${path}`, {
    provider: VNDIRECT,
    timeoutMs,
    retries: 1,
    backoffBaseMs: 180,
    headers: VND_HEADERS,
  });
  recordVndLatency(path, performance.now() - t0, Boolean(res.ok && res.data != null));
  if (!res.ok || res.data == null) throw new ProviderError(`vndirect: ${res.error ?? "unreachable"}`, VNDIRECT);
  return res.data;
}

/** Universe đầy đủ (phân trang + mã mới niêm yết) */
export async function getVndUniverse(): Promise<
  { symbol: string; name: string | null; exchange: string | null; industry: string | null }[]
> {
  const rows = await fetchVndFullUniverse();
  return rows.map((r) => ({
    symbol: r.symbol,
    name: r.name,
    exchange: r.exchange,
    industry: r.industry,
  }));
}

let _sessionDateCache: { date: string; until: number } | null = null;
export async function getVndLatestSessionDate(): Promise<string> {
  if (_sessionDateCache && Date.now() < _sessionDateCache.until) return _sessionDateCache.date;
  const payload = await vndGet<Page<{ date?: string }>>("/v4/stock_prices?size=1&sort=date:desc", 4_000);
  const d = payload.data?.[0]?.date;
  if (!d) throw new ProviderError("vndirect: no session date", VNDIRECT);
  const date = String(d).slice(0, 10);
  _sessionDateCache = { date, until: Date.now() + 60_000 };
  return date;
}

export async function getVndIndices(): Promise<{ items: IndexQuote[]; sourceTs: number | null }> {
  const codes = ["VNINDEX", "VN30", "HNX", "HNX30", "UPCOM"];
  const items: IndexQuote[] = [];
  let newest: number | null = null;
  const results = await Promise.allSettled(
    codes.map((code) =>
      vndGet<Page<VndPriceRow>>(`/v4/vnmarket_prices?q=code:${code}&size=1&sort=date:desc`, 4_500),
    ),
  );
  for (let i = 0; i < codes.length; i++) {
    const settled = results[i];
    if (!settled || settled.status !== "fulfilled") continue;
    const r = settled.value.data?.[0];
    if (!r?.close) continue;
    const code = codes[i]!;
    const ts = r.date ? Date.parse(`${r.date}T15:00:00+07:00`) : null;
    if (ts != null && Number.isFinite(ts) && (newest == null || ts > newest)) newest = ts;
    items.push({
      code,
      name: code,
      value: r.close,
      change: num(r.change) ?? 0,
      changePercent: num(r.changePercent) ?? num(r.changeRatio) ?? num(r.pctChange) ?? 0,
      volume: num(r.nmVolume),
      updatedAt: r.date ?? null,
    });
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
      12_000,
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
      vndGet<Page<VndPriceRow>>(`/v4/stock_prices?q=code:${s}~date:${date}&size=1&sort=date:desc`, 5_000),
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
    `/v4/stock_prices?q=code:${symbol.toUpperCase()}&size=${Math.min(size, 500)}&sort=date:asc`,
    7_000,
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

const INDEX_ALIASES: Record<string, string> = {
  VNINDEX: "VNINDEX", "VN-INDEX": "VNINDEX", VN_INDEX: "VNINDEX", VNI: "VNINDEX", VNINDEXINDEX: "VNINDEX",
  VN30: "VN30", "VN-30": "VN30", VN30INDEX: "VN30",
  HNX: "HNX", HNXINDEX: "HNX", "HNX-INDEX": "HNX", HNX_INDEX: "HNX",
  HNX30: "HNX30", "HNX-30": "HNX30", HNX30INDEX: "HNX30",
  UPCOM: "UPCOM", UPCOMINDEX: "UPCOM", "UPCOM-INDEX": "UPCOM", UPCOM_INDEX: "UPCOM",
  VNXALL: "VNXALL", "VNX-ALL": "VNXALL", VNXALLSHARE: "VNXALL",
  VN100: "VN100", "VN-100": "VN100",
};

export function vndIndexCode(code: string): string {
  const raw = code.toUpperCase().trim();
  const stripped = raw.replace(/[^A-Z0-9]/g, "");
  return INDEX_ALIASES[raw] ?? INDEX_ALIASES[stripped] ?? stripped;
}

export function isVnIndexSymbol(symbol: string): boolean {
  const raw = symbol.toUpperCase().trim();
  const stripped = raw.replace(/[^A-Z0-9]/g, "");
  return raw in INDEX_ALIASES || stripped in INDEX_ALIASES;
}

export async function getVndIndexOhlcv(code: string, size = 250): Promise<OhlcvBar[]> {
  const idx = vndIndexCode(code);
  const payload = await vndGet<Page<VndPriceRow>>(
    `/v4/vnmarket_prices?q=code:${idx}&size=${Math.min(size, 500)}&sort=date:asc`,
    7_000,
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
    5_000,
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
      Page<{ code?: string; type?: string; floor?: string; buyVal?: number; sellVal?: number; netVal?: number }>
    >(`/v4/foreigns?q=tradingDate:${date}~type:STOCK&size=${pageSize}&page=${page}`, 12_000);
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
      if (Math.abs(nv) > 0) rows.push({ symbol, buyVal: bv, sellVal: sv, netVal: nv, floor: r.floor ?? null });
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
  const probe = await vndGet<Page<{ tradingDate?: string }>>(`/v4/foreigns?q=type:ETF&size=1&sort=tradingDate:desc`, 8_000);
  const d = probe.data?.[0]?.tradingDate;
  if (!d) throw new ProviderError("vndirect: no ETF foreign session date", VNDIRECT);
  return String(d).slice(0, 10);
}

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
        Page<{ code?: string; type?: string; floor?: string; buyVal?: number; sellVal?: number; netVal?: number }>
      >(`/v4/foreigns?q=tradingDate:${d}~type:ETF&size=${pageSize}&page=${page}`, 12_000);
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
        if (Math.abs(nv) > 0) rows.push({ symbol, buyVal: bv, sellVal: sv, netVal: nv, floor: r.floor ?? null });
      }
      if (!data.length) break;
      page += 1;
    }
    return { buyVal, sellVal, netVal, stockCount, rows };
  };
  let pack = await load(date);
  if (pack.stockCount === 0 || (pack.buyVal === 0 && pack.sellVal === 0)) {
    const probe = await vndGet<Page<{ tradingDate?: string }>>(`/v4/foreigns?q=type:ETF&size=1&sort=tradingDate:desc`, 8_000);
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
