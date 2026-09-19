import "server-only";
import { httpJson } from "../http";
import type { Quote } from "../types";

/**
 * VPS public datafeed — bảng giá realtime HOSE/HNX/UPCOM (không cần API key).
 * Endpoint: https://bgapidatafeed.vps.com.vn/getliststockdata/SYM1,SYM2
 * Giá thường ở đơn vị nghìn đồng (lastPrice 26.85 = 26,850 VND).
 * Batch 40 mã/request, parallel chunks — hỗ trợ board lớn (VN30 + rổ thanh khoản).
 */

const BASE = "https://bgapidatafeed.vps.com.vn";
const CHUNK = 40;
const MAX_SYMBOLS = 160;

type VpsRow = {
  sym?: string;
  lastPrice?: number | string;
  openPrice?: number | string;
  highPrice?: number | string;
  lowPrice?: number | string;
  avePrice?: number | string;
  changePc?: number | string;
  ot?: number | string;
  lot?: number | string;
  r?: number | string;
  c?: number | string;
  f?: number | string;
  closePrice?: number | string;
};

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function toVnd(price: number | null): number | null {
  if (price == null) return null;
  if (price > 0 && price < 500) return Math.round(price * 1000);
  return price;
}

function mapRow(r: VpsRow): Quote | null {
  const symbol = String(r.sym ?? "").toUpperCase();
  if (!symbol) return null;
  const rawLast = num(r.lastPrice) ?? num(r.avePrice);
  const closeFull = num(r.closePrice);
  let price = toVnd(rawLast);
  if (closeFull != null && closeFull > 1000) {
    if (price == null || Math.abs(closeFull - price) / closeFull > 0.5) price = closeFull;
    else price = closeFull;
  }
  if (price == null || price <= 0) return null;

  const ref = toVnd(num(r.r));
  const chgAbs = num(r.ot);
  const chgPct = num(r.changePc);
  return {
    symbol,
    assetClass: "stock",
    price,
    change: chgAbs != null ? (Math.abs(chgAbs) < 500 ? chgAbs * 1000 : chgAbs) : ref != null ? price - ref : null,
    changePercent: chgPct,
    open: toVnd(num(r.openPrice)),
    high: toVnd(num(r.highPrice)),
    low: toVnd(num(r.lowPrice)),
    volume: num(r.lot) != null ? Math.round(Number(r.lot) * 100) : null,
    quoteVolume: null,
    referencePrice: ref,
    ceilingPrice: toVnd(num(r.c)),
    floorPrice: toVnd(num(r.f)),
    updatedAt: new Date().toISOString(),
  };
}

async function fetchChunk(syms: string[]): Promise<Quote[]> {
  const res = await httpJson<VpsRow[]>(`${BASE}/getliststockdata/${syms.join(",")}`, {
    provider: "vps",
    timeoutMs: 4_000,
    retries: 0,
    headers: {
      Accept: "application/json",
      "User-Agent": "Orca-Multi-Finance/1.0",
    },
  });
  if (!res.ok || !Array.isArray(res.data)) return [];
  const out: Quote[] = [];
  for (const r of res.data) {
    const q = mapRow(r);
    if (q) out.push(q);
  }
  return out;
}

export async function getVpsQuotes(symbols: string[]): Promise<{
  quotes: Quote[];
  sourceTs: number | null;
}> {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))].slice(0, MAX_SYMBOLS);
  if (!uniq.length) return { quotes: [], sourceTs: null };

  const chunks: string[][] = [];
  for (let i = 0; i < uniq.length; i += CHUNK) chunks.push(uniq.slice(i, i + CHUNK));

  const parts = await Promise.all(chunks.map((c) => fetchChunk(c).catch(() => [] as Quote[])));
  const bySym = new Map<string, Quote>();
  for (const list of parts) {
    for (const q of list) bySym.set(q.symbol, q);
  }
  const quotes = [...bySym.values()];
  if (!quotes.length) throw new Error("vps: no quotes mapped");
  return { quotes, sourceTs: Date.now() };
}
