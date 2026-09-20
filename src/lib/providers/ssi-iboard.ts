import "server-only";
import { httpJson } from "../http";
import type { Quote } from "../types";

/**
 * SSI iBoard public query — full exchange board without FCData credentials.
 * https://iboard-query.ssi.com.vn/stock/exchange/{hose|hnx|upcom}?boardId=MAIN
 */

const BASE = "https://iboard-query.ssi.com.vn";

type SsiBoardRow = {
  stockSymbol?: string;
  companyNameVi?: string;
  companyNameEn?: string;
  exchange?: string;
  matchedPrice?: number;
  priorClosePrice?: number;
  refPrice?: number;
  openPrice?: number;
  highest?: number;
  lowest?: number;
  priceChange?: number;
  priceChangePercent?: number;
  ceiling?: number;
  floor?: number;
  nmTotalTradedQty?: number;
  nmTotalTradedValue?: number;
  stockVol?: number;
  firstTradingDate?: string;
};

type SsiEnvelope = {
  code?: string;
  data?: SsiBoardRow[];
};

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export type SsiUniverseItem = {
  symbol: string;
  name: string | null;
  exchange: string | null;
  listedDate: string | null;
};

async function fetchExchange(ex: "hose" | "hnx" | "upcom"): Promise<SsiBoardRow[]> {
  const res = await httpJson<SsiEnvelope>(`${BASE}/stock/exchange/${ex}?boardId=MAIN`, {
    provider: "ssi-iboard",
    timeoutMs: 5_000,
    retries: 0,
    headers: {
      Accept: "application/json",
      Origin: "https://iboard.ssi.com.vn",
      Referer: "https://iboard.ssi.com.vn/",
    },
  });
  if (!res.ok || !res.data?.data) return [];
  return res.data.data;
}

export async function getSsiIboardUniverse(): Promise<SsiUniverseItem[]> {
  const [hose, hnx, upcom] = await Promise.all([
    fetchExchange("hose"),
    fetchExchange("hnx"),
    fetchExchange("upcom"),
  ]);
  const out: SsiUniverseItem[] = [];
  const push = (rows: SsiBoardRow[], floor: string) => {
    for (const r of rows) {
      const symbol = String(r.stockSymbol ?? "").toUpperCase();
      if (!symbol) continue;
      const ft = String(r.firstTradingDate ?? "");
      const listedDate =
        ft && ft !== "0" && ft.length >= 8
          ? ft.length === 8
            ? `${ft.slice(0, 4)}-${ft.slice(4, 6)}-${ft.slice(6, 8)}`
            : ft.slice(0, 10)
          : null;
      out.push({
        symbol,
        name: r.companyNameVi ?? r.companyNameEn ?? null,
        exchange: (r.exchange ?? floor).toUpperCase(),
        listedDate,
      });
    }
  };
  push(hose, "HOSE");
  push(hnx, "HNX");
  push(upcom, "UPCOM");
  return out;
}

export async function getSsiIboardQuotes(symbols: string[]): Promise<{
  quotes: Quote[];
  sourceTs: number | null;
}> {
  const want = new Set(symbols.map((s) => s.toUpperCase()));
  if (!want.size) return { quotes: [], sourceTs: null };
  const [hose, hnx, upcom] = await Promise.all([
    fetchExchange("hose"),
    fetchExchange("hnx"),
    fetchExchange("upcom"),
  ]);
  const quotes: Quote[] = [];
  for (const r of [...hose, ...hnx, ...upcom]) {
    const symbol = String(r.stockSymbol ?? "").toUpperCase();
    if (!want.has(symbol)) continue;
    const price = num(r.matchedPrice) ?? num(r.refPrice);
    if (price == null || price <= 0) continue;
    quotes.push({
      symbol,
      assetClass: "stock",
      name: r.companyNameVi ?? r.companyNameEn ?? null,
      price,
      change: num(r.priceChange),
      changePercent: num(r.priceChangePercent),
      open: num(r.openPrice),
      high: num(r.highest),
      low: num(r.lowest),
      volume: num(r.nmTotalTradedQty) ?? num(r.stockVol),
      quoteVolume: num(r.nmTotalTradedValue),
      referencePrice: num(r.refPrice) ?? num(r.priorClosePrice),
      ceilingPrice: num(r.ceiling),
      floorPrice: num(r.floor),
      updatedAt: new Date().toISOString(),
    });
  }
  return { quotes, sourceTs: quotes.length ? Date.now() : null };
}
