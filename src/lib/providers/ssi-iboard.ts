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
  stockName?: string;
  companyName?: string;
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

export type SsiIboardUniverseItem = {
  symbol: string;
  name: string | null;
  exchange: string;
  listedDate: string | null;
};

function mapRow(r: SsiBoardRow): Quote | null {
  const code = (r.stockSymbol ?? "").toUpperCase();
  if (!code) return null;
  const last = Number(r.matchedPrice ?? 0);
  if (!last || !Number.isFinite(last)) return null;
  return {
    symbol: code,
    assetClass: "stock",
    name: r.stockName ?? r.companyName ?? null,
    price: last,
    change: Number.isFinite(Number(r.priceChange)) ? Number(r.priceChange) : null,
    changePercent: Number.isFinite(Number(r.priceChangePercent)) ? Number(r.priceChangePercent) : null,
    volume: Number(r.totalMatchVolume ?? 0) || null,
    quoteVolume: Number(r.totalMatchValue ?? 0) || null,
    high: Number(r.highest ?? 0) || null,
    low: Number(r.lowest ?? 0) || null,
    open: Number(r.openPrice ?? 0) || null,
    referencePrice: Number(r.refPrice ?? 0) || null,
    ceilingPrice: Number(r.ceiling ?? 0) || null,
    floorPrice: Number(r.floor ?? 0) || null,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * iBoard has no per-symbol query — one call returns the whole exchange board.
 * A short memo (8s) keeps board/multi-quote/screener bursts from re-downloading
 * the same three boards several times per request.
 */
const BOARD_MEMO_TTL_MS = 8_000;
const boardMemo = new Map<string, { at: number; rows: SsiBoardRow[] }>();

export function clearSsiBoardMemo(): void {
  boardMemo.clear();
}

async function fetchExchange(ex: "hose" | "hnx" | "upcom"): Promise<SsiBoardRow[]> {
  const hit = boardMemo.get(ex);
  if (hit && Date.now() - hit.at < BOARD_MEMO_TTL_MS) return hit.rows;
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
  if (!res.ok || !res.data?.data) return hit?.rows ?? [];
  boardMemo.set(ex, { at: Date.now(), rows: res.data.data });
  return res.data.data;
}

const EX_LABEL: Record<"hose" | "hnx" | "upcom", string> = {
  hose: "HOSE",
  hnx: "HNX",
  upcom: "UPCOM",
};

/** Full listed universe from SSI iBoard boards (no API key). */
export async function getSsiIboardUniverse(): Promise<SsiIboardUniverseItem[]> {
  const [hose, hnx, upcom] = await Promise.all([
    fetchExchange("hose"),
    fetchExchange("hnx"),
    fetchExchange("upcom"),
  ]);
  const out: SsiIboardUniverseItem[] = [];
  const seen = new Set<string>();
  for (const [ex, rows] of [
    ["hose", hose],
    ["hnx", hnx],
    ["upcom", upcom],
  ] as const) {
    for (const r of rows) {
      const symbol = (r.stockSymbol ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!symbol || symbol.length < 2 || seen.has(symbol)) continue;
      // skip index-like codes
      if (symbol.includes("INDEX") || symbol === "VN30" || symbol === "HNX30") continue;
      seen.add(symbol);
      out.push({
        symbol,
        name: r.stockName ?? r.companyName ?? null,
        exchange: EX_LABEL[ex],
        listedDate: null,
      });
    }
  }
  return out;
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
