import "server-only";
import { httpJson } from "../http";
import type { VnOrderBook, VnOrderBookLevel } from "../services/stock-orderbook";

/**
 * Order-book depth qua REST public — không cần SSI WS / API key.
 * - SSI iBoard: best1..3 Bid/Offer + vol (VND đầy đủ)
 * - VPS datafeed: g1..g3 bid, g4..g6 ask (giá nghìn đồng, vol lot)
 */

const SSI_BASE = "https://iboard-query.ssi.com.vn";
const VPS_BASE = "https://bgapidatafeed.vps.com.vn";

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function level(price: number | null, volume: number | null): VnOrderBookLevel | null {
  if (price == null || price <= 0 || volume == null || volume < 0) return null;
  return { price, volume };
}

function totals(bids: VnOrderBookLevel[], asks: VnOrderBookLevel[]) {
  const bidTotal = bids.reduce((s, x) => s + x.volume, 0);
  const askTotal = asks.reduce((s, x) => s + x.volume, 0);
  const total = bidTotal + askTotal;
  return {
    bidTotal,
    askTotal,
    imbalance: total > 0 ? (bidTotal - askTotal) / total : null,
  };
}

type SsiStock = {
  stockSymbol?: string;
  matchedPrice?: number;
  refPrice?: number;
  ceiling?: number;
  floor?: number;
  session?: string;
  best1Bid?: number;
  best1BidVol?: number;
  best2Bid?: number;
  best2BidVol?: number;
  best3Bid?: number;
  best3BidVol?: number;
  best1Offer?: number;
  best1OfferVol?: number;
  best2Offer?: number;
  best2OfferVol?: number;
  best3Offer?: number;
  best3OfferVol?: number;
};

type SsiEnvelope = { code?: string; data?: SsiStock | null };

export async function fetchSsiIboardDepth(symbol: string): Promise<VnOrderBook | null> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return null;
  const res = await httpJson<SsiEnvelope>(`${SSI_BASE}/stock/${sym}`, {
    provider: "ssi-iboard-depth",
    timeoutMs: 5_000,
    retries: 1,
    headers: {
      Accept: "application/json",
      Origin: "https://iboard.ssi.com.vn",
      Referer: "https://iboard.ssi.com.vn/",
    },
  });
  if (!res.ok || !res.data?.data) return null;
  const d = res.data.data;
  const bids = [
    level(num(d.best1Bid), num(d.best1BidVol)),
    level(num(d.best2Bid), num(d.best2BidVol)),
    level(num(d.best3Bid), num(d.best3BidVol)),
  ].filter(Boolean) as VnOrderBookLevel[];
  const asks = [
    level(num(d.best1Offer), num(d.best1OfferVol)),
    level(num(d.best2Offer), num(d.best2OfferVol)),
    level(num(d.best3Offer), num(d.best3OfferVol)),
  ].filter(Boolean) as VnOrderBookLevel[];
  if (!bids.length && !asks.length) return null;
  const t = totals(bids, asks);
  return {
    symbol: sym,
    bids,
    asks,
    bidTotal: t.bidTotal,
    askTotal: t.askTotal,
    imbalance: t.imbalance,
    lastPrice: num(d.matchedPrice),
    ceiling: num(d.ceiling),
    floor: num(d.floor),
    ref: num(d.refPrice),
    session: d.session ?? null,
    eventTime: Date.now(),
    levels: Math.max(bids.length, asks.length),
    trades: [],
    tradeBuyVol: 0,
    tradeSellVol: 0,
    tradeTotalVol: 0,
    fromLastSession: false,
  };
}

type VpsRow = {
  sym?: string;
  lastPrice?: number | string;
  r?: number | string;
  c?: number | string;
  f?: number | string;
  g1?: string;
  g2?: string;
  g3?: string;
  g4?: string;
  g5?: string;
  g6?: string;
  closePrice?: number | string;
};

/** VPS: "38.6|770|i" → price nghìn đồng, vol lot → *100 shares */
function parseVpsLevel(raw: string | undefined, isBid: boolean): VnOrderBookLevel | null {
  if (!raw) return null;
  const parts = String(raw).split("|");
  if (parts.length < 2) return null;
  let price = num(parts[0]);
  const lot = num(parts[1]);
  if (price == null || price <= 0 || lot == null) return null;
  // scale nghìn → VND
  if (price < 500) price = Math.round(price * 1000);
  const volume = Math.round(lot * 100);
  if (volume <= 0 && parts[2] === "e") return null;
  return { price, volume };
}

export async function fetchVpsDepth(symbol: string): Promise<VnOrderBook | null> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return null;
  const res = await httpJson<VpsRow[]>(`${VPS_BASE}/getliststockdata/${sym}`, {
    provider: "vps-depth",
    timeoutMs: 4_000,
    retries: 1,
    headers: { Accept: "application/json" },
  });
  if (!res.ok || !Array.isArray(res.data) || !res.data[0]) return null;
  const d = res.data[0]!;
  const bids = [
    parseVpsLevel(d.g1, true),
    parseVpsLevel(d.g2, true),
    parseVpsLevel(d.g3, true),
  ].filter(Boolean) as VnOrderBookLevel[];
  const asks = [
    parseVpsLevel(d.g4, false),
    parseVpsLevel(d.g5, false),
    parseVpsLevel(d.g6, false),
  ].filter(Boolean) as VnOrderBookLevel[];
  if (!bids.length && !asks.length) return null;

  let last = num(d.lastPrice);
  if (last != null && last < 500) last = Math.round(last * 1000);
  const closeFull = num(d.closePrice);
  if (closeFull != null && closeFull > 1000) last = closeFull;

  const scale = (v: number | null) => {
    if (v == null) return null;
    return v < 500 ? Math.round(v * 1000) : v;
  };

  const t = totals(bids, asks);
  return {
    symbol: sym,
    bids,
    asks,
    bidTotal: t.bidTotal,
    askTotal: t.askTotal,
    imbalance: t.imbalance,
    lastPrice: last,
    ceiling: scale(num(d.c)),
    floor: scale(num(d.f)),
    ref: scale(num(d.r)),
    session: null,
    eventTime: Date.now(),
    levels: Math.max(bids.length, asks.length),
    trades: [],
    tradeBuyVol: 0,
    tradeSellVol: 0,
    tradeTotalVol: 0,
    fromLastSession: false,
  };
}
