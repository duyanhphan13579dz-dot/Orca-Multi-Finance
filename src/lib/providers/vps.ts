import "server-only";
import { httpJson } from "../http";
import type { Quote } from "../types";

/**
 * VPS public datafeed — bảng giá realtime HOSE/HNX/UPCOM (không cần API key).
 * Endpoint: https://bgapidatafeed.vps.com.vn/getliststockdata/SYM1,SYM2
 * Giá thường cập nhật nhanh; dùng làm tier-A song song với VNDirect.
 */

const BASE = "https://bgapidatafeed.vps.com.vn";
const CHUNK = 40;

interface VpsRow {
  stock_code?: string;
  stockCode?: string;
  last_price?: number;
  lastPrice?: number;
  change_price?: number;
  changePrice?: number;
  change_percent?: number;
  changePercent?: number;
  total_vol?: number;
  totalVol?: number;
  total_val?: number;
  totalVal?: number;
  high_price?: number;
  highPrice?: number;
  low_price?: number;
  lowPrice?: number;
  open_price?: number;
  openPrice?: number;
  ref_price?: number;
  refPrice?: number;
  ceiling_price?: number;
  ceilingPrice?: number;
  floor_price?: number;
  floorPrice?: number;
}

function mapRow(r: VpsRow): Quote | null {
  const code = (r.stock_code ?? r.stockCode ?? "").toUpperCase();
  if (!code) return null;
  const last = Number(r.last_price ?? r.lastPrice ?? 0);
  if (!last || !Number.isFinite(last)) return null;
  const change = Number(r.change_price ?? r.changePrice ?? 0);
  const changePercent = Number(r.change_percent ?? r.changePercent ?? 0);
  return {
    symbol: code,
    assetClass: "stock",
    price: last,
    change: Number.isFinite(change) ? change : null,
    changePercent: Number.isFinite(changePercent) ? changePercent : null,
    volume: Number(r.total_vol ?? r.totalVol ?? 0) || null,
    quoteVolume: Number(r.total_val ?? r.totalVal ?? 0) || null,
    high: Number(r.high_price ?? r.highPrice ?? 0) || null,
    low: Number(r.low_price ?? r.lowPrice ?? 0) || null,
    open: Number(r.open_price ?? r.openPrice ?? 0) || null,
    referencePrice: Number(r.ref_price ?? r.refPrice ?? 0) || null,
    ceilingPrice: Number(r.ceiling_price ?? r.ceilingPrice ?? 0) || null,
    floorPrice: Number(r.floor_price ?? r.floorPrice ?? 0) || null,
    updatedAt: new Date().toISOString(),
  };
}

async function fetchChunk(syms: string[]): Promise<Quote[]> {
  const res = await httpJson<VpsRow[]>(`${BASE}/getliststockdata/${syms.join(",")}`, {
    provider: "vps",
    timeoutMs: 7_500,
    retries: 1,
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

export async function getVpsQuotes(symbols: string[]): Promise<Quote[]> {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
  if (!uniq.length) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < uniq.length; i += CHUNK) chunks.push(uniq.slice(i, i + CHUNK));
  const batches = await Promise.all(chunks.map(fetchChunk));
  return batches.flat();
}
