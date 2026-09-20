import "server-only";
import { httpJson } from "../http";
import type { Quote } from "../types";

/**
 * SSI iBoard public board — không cần API key.
 * Endpoint: https://iboard-query.ssi.com.vn/stock/exchange/{hose|hnx|upcom}?boardId=MAIN
 */

const BASE = "https://iboard-query.ssi.com.vn";

interface SsiBoardRow {
  stockSymbol?: string;
  matchedPrice?: number;
  priceChange?: number;
  priceChangePercent?: number;
  totalMatchVolume?: number;
  totalMatchValue?: number;
  highest?: number;
  lowest?: number;
  openPrice?: number;
  refPrice?: number;
  ceiling?: number;
  floor?: number;
}

interface SsiEnvelope {
  data?: SsiBoardRow[];
}

function mapRow(r: SsiBoardRow): Quote | null {
  const code = (r.stockSymbol ?? "").toUpperCase();
  if (!code) return null;
  const last = Number(r.matchedPrice ?? 0);
  if (!last || !Number.isFinite(last)) return null;
  return {
    symbol: code,
    price: last,
    change: Number.isFinite(Number(r.priceChange)) ? Number(r.priceChange) : null,
    changePercent: Number.isFinite(Number(r.priceChangePercent)) ? Number(r.priceChangePercent) : null,
    volume: Number(r.totalMatchVolume ?? 0) || null,
    value: Number(r.totalMatchValue ?? 0) || null,
    high: Number(r.highest ?? 0) || null,
    low: Number(r.lowest ?? 0) || null,
    open: Number(r.openPrice ?? 0) || null,
    ref: Number(r.refPrice ?? 0) || null,
    ceiling: Number(r.ceiling ?? 0) || null,
    floor: Number(r.floor ?? 0) || null,
    source: "ssi-iboard",
    ts: Date.now(),
  };
}

async function fetchExchange(ex: "hose" | "hnx" | "upcom"): Promise<SsiBoardRow[]> {
  const res = await httpJson<SsiEnvelope>(`${BASE}/stock/exchange/${ex}?boardId=MAIN`, {
    provider: "ssi-iboard",
    timeoutMs: 8_500,
    retries: 1,
    headers: {
      Accept: "application/json",
      Origin: "https://iboard.ssi.com.vn",
      Referer: "https://iboard.ssi.com.vn/",
    },
  });
  if (!res.ok || !res.data?.data) return [];
  return res.data.data;
}

export async function getSsiIboardQuotes(symbols: string[]): Promise<Quote[]> {
  const want = new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean));
  if (!want.size) return [];
  const [hose, hnx, upcom] = await Promise.all([
    fetchExchange("hose"),
    fetchExchange("hnx"),
    fetchExchange("upcom"),
  ]);
  const out: Quote[] = [];
  for (const r of [...hose, ...hnx, ...upcom]) {
    const q = mapRow(r);
    if (q && want.has(q.symbol)) out.push(q);
  }
  return out;
}
