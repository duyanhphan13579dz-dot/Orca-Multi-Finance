import "server-only";
import { httpJson } from "../http";
import type { Quote } from "../types";
import { ProviderError } from "./binance";

export const VNDIRECT_MQ = "vndirect";

const PRIMARY_BASE = () =>
  (process.env.VNDIRECT_BASE_URL ?? "https://api-finfo.vndirect.com.vn").replace(/\/$/, "");

function vndBases(): string[] {
  const primary = PRIMARY_BASE();
  const alts = ["https://api-finfo.vndirect.com.vn", "https://finfo-api.vndirect.com.vn"];
  const out: string[] = [];
  for (const b of [primary, ...alts]) {
    const n = b.replace(/\/$/, "");
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

let lastGoodBase = 0;

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

type VndPriceRow = {
  code?: string;
  date?: string;
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
};

type Page<T> = { data?: T[]; totalPages?: number };

const VND_HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  Origin: "https://dstock.vndirect.com.vn",
  Referer: "https://dstock.vndirect.com.vn/",
  "X-Requested-With": "XMLHttpRequest",
};

async function vndGet<T>(path: string, timeoutMs = 8_000): Promise<T> {
  const bases = vndBases();
  let lastErr = "unreachable";
  for (let i = 0; i < bases.length; i++) {
    const idx = (lastGoodBase + i) % bases.length;
    const res = await httpJson<T>(`${bases[idx]}${path}`, {
      provider: VNDIRECT_MQ,
      timeoutMs,
      retries: 2,
      backoffBaseMs: 220,
      headers: VND_HEADERS,
    });
    if (res.ok && res.data != null) {
      lastGoodBase = idx;
      return res.data;
    }
    lastErr = res.error ?? "unreachable";
  }
  throw new ProviderError(`vndirect: ${lastErr}`, VNDIRECT_MQ);
}

function mapVndPriceRow(r: VndPriceRow): Quote | null {
  const symbol = String(r.code ?? "").toUpperCase();
  const price = num(r.close);
  if (!symbol || price == null || price <= 0) return null;
  return {
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
  };
}

let _sessionDateCache: { date: string; until: number } | null = null;
async function getSessionDate(): Promise<string> {
  if (_sessionDateCache && Date.now() < _sessionDateCache.until) return _sessionDateCache.date;
  const payload = await vndGet<Page<{ date?: string }>>("/v4/stock_prices?size=1&sort=date:desc", 5_000);
  const d = payload.data?.[0]?.date;
  if (!d) throw new ProviderError("vndirect: no session date", VNDIRECT_MQ);
  const date = String(d).slice(0, 10);
  _sessionDateCache = { date, until: Date.now() + 60_000 };
  return date;
}

/** Page 1 first, then remaining pages in parallel batches of 4. Cap 8 pages. */
export async function fetchVndMarketQuotesParallel(
  sessionDate?: string,
): Promise<{ quotes: Quote[]; sourceTs: number | null; sessionDate: string }> {
  const date = sessionDate ?? (await getSessionDate());
  const pageSize = 500;
  const MAX_PAGES = 8;
  const PAGE_TIMEOUT = 7_000;
  const quotes: Quote[] = [];
  let newest: number | null = null;

  const ingest = (data: VndPriceRow[]) => {
    for (const r of data) {
      const q = mapVndPriceRow(r);
      if (!q) continue;
      const t = r.date ? Date.parse(`${r.date}T15:00:00+07:00`) : null;
      if (t != null && Number.isFinite(t) && (newest == null || t > newest)) newest = t;
      quotes.push(q);
    }
  };

  const first = await vndGet<Page<VndPriceRow>>(
    `/v4/stock_prices?q=date:${date}~type:STOCK&size=${pageSize}&page=1`,
    PAGE_TIMEOUT,
  );
  ingest(first.data ?? []);
  const totalPages = Math.min(MAX_PAGES, Math.max(1, Number(first.totalPages) || 1));

  if (totalPages > 1) {
    const remaining = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
    const BATCH = 4;
    for (let i = 0; i < remaining.length; i += BATCH) {
      const batch = remaining.slice(i, i + BATCH);
      const settled = await Promise.allSettled(
        batch.map((page) =>
          vndGet<Page<VndPriceRow>>(
            `/v4/stock_prices?q=date:${date}~type:STOCK&size=${pageSize}&page=${page}`,
            PAGE_TIMEOUT,
          ),
        ),
      );
      for (const s of settled) {
        if (s.status === "fulfilled") ingest(s.value.data ?? []);
      }
    }
  }

  if (!quotes.length) throw new ProviderError("vndirect: empty market quotes", VNDIRECT_MQ);
  return { quotes, sourceTs: newest, sessionDate: date };
}
