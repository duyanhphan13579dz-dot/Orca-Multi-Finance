import "server-only";
import { buildMeta } from "../freshness";
import { ssiFcConfigured } from "../providers/ssi-fcdata";
import { ensureSsiWsStarted, ssiWs, type SsiOrderBook, type SsiTrade } from "../realtime/ssi-ws";
import type { Meta } from "../types";

export interface VnOrderBookLevel {
  price: number;
  volume: number;
}

export interface VnTrade {
  price: number;
  volume: number;
  change: number | null;
  changePercent: number | null;
  side: "buy" | "sell" | "unknown";
  time: string | null;
  eventTime: number;
}

/** Live order book (sổ lệnh) + match tape from SSI DataHub streaming. */
export interface VnOrderBook {
  symbol: string;
  bids: VnOrderBookLevel[];
  asks: VnOrderBookLevel[];
  bidTotal: number;
  askTotal: number;
  imbalance: number | null;
  lastPrice: number | null;
  ceiling: number | null;
  floor: number | null;
  ref: number | null;
  session: string | null;
  eventTime: number;
  levels: number;
  trades: VnTrade[];
  tradeBuyVol: number;
  tradeSellVol: number;
  tradeTotalVol: number;
}

function bootSsiLive() {
  if (!ssiFcConfigured()) return;
  if (process.env.SSI_WS_DISABLED === "true") return;
  try {
    ensureSsiWsStarted();
  } catch {
    /* non-fatal */
  }
}

function mapTrades(list: SsiTrade[]): VnTrade[] {
  return list.map((t) => ({
    price: t.price,
    volume: t.volume,
    change: t.change,
    changePercent: t.changePercent,
    side: t.side,
    time: t.time,
    eventTime: t.eventTime,
  }));
}

export async function getVnOrderBook(
  symbol: string,
): Promise<{ book: VnOrderBook; meta: Meta } | null> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return null;

  if (!ssiFcConfigured()) {
    return null;
  }

  bootSsiLive();
  if (process.env.SSI_WS_DISABLED === "true") {
    return null;
  }

  ssiWs.watchSymbol(sym);

  let ob: SsiOrderBook | null = ssiWs.getOrderBook(sym, 60_000);
  if (!ob) {
    const q = ssiWs.getQuote(sym, 60_000);
    ob = q?.orderBook ?? null;
  }

  if (!ob) {
    await new Promise((r) => setTimeout(r, 900));
    ob = ssiWs.getOrderBook(sym, 60_000);
    if (!ob) {
      const q = ssiWs.getQuote(sym, 60_000);
      ob = q?.orderBook ?? null;
    }
  }

  const trades = mapTrades(ssiWs.getTrades(sym, 50));
  const tradeBuyVol = trades.filter((t) => t.side === "buy").reduce((s, t) => s + t.volume, 0);
  const tradeSellVol = trades.filter((t) => t.side === "sell").reduce((s, t) => s + t.volume, 0);
  const tradeTotalVol = trades.reduce((s, t) => s + t.volume, 0);

  if ((!ob || (ob.bids.length === 0 && ob.asks.length === 0)) && trades.length === 0) {
    return null;
  }

  const bids = ob?.bids ?? [];
  const asks = ob?.asks ?? [];
  const bidTotal = ob?.bidTotal ?? 0;
  const askTotal = ob?.askTotal ?? 0;
  const total = bidTotal + askTotal;
  const imbalance = total > 0 ? (bidTotal - askTotal) / total : null;

  const book: VnOrderBook = {
    symbol: sym,
    bids,
    asks,
    bidTotal,
    askTotal,
    imbalance,
    lastPrice: ob?.lastPrice ?? trades[0]?.price ?? null,
    ceiling: ob?.ceiling ?? null,
    floor: ob?.floor ?? null,
    ref: ob?.ref ?? null,
    session: ob?.session ?? null,
    eventTime: ob?.eventTime ?? trades[0]?.eventTime ?? Date.now(),
    levels: Math.max(bids.length, asks.length),
    trades,
    tradeBuyVol,
    tradeSellVol,
    tradeTotalVol,
  };

  return {
    book,
    meta: buildMeta({
      source: "ssi-ws",
      sourceTimestampMs: book.eventTime,
      note: `Độ sâu SSI · ${book.levels} mức · ${trades.length} khớp`,
      slas: { liveSlaMs: 15_000, freshSlaMs: 60_000, delayedSlaMs: 180_000 },
    }),
  };
}
