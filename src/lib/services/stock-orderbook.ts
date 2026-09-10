import "server-only";
import { buildMeta } from "../freshness";
import { ssiFcConfigured } from "../providers/ssi-fcdata";
import { ensureSsiWsStarted, ssiWs, type SsiOrderBook } from "../realtime/ssi-ws";
import type { Meta } from "../types";

/** Live order book (sổ lệnh) from SSI DataHub streaming (X / X-QUOTE). */
export interface VnOrderBook {
  symbol: string;
  bids: { price: number; volume: number }[];
  asks: { price: number; volume: number }[];
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

  let ob: SsiOrderBook | null = ssiWs.getOrderBook(sym, 45_000);
  if (!ob) {
    const q = ssiWs.getQuote(sym, 45_000);
    ob = q?.orderBook ?? null;
  }

  if (!ob) {
    await new Promise((r) => setTimeout(r, 800));
    ob = ssiWs.getOrderBook(sym, 45_000);
    if (!ob) {
      const q = ssiWs.getQuote(sym, 45_000);
      ob = q?.orderBook ?? null;
    }
  }

  if (!ob || (ob.bids.length === 0 && ob.asks.length === 0)) {
    return null;
  }

  const bidTotal = ob.bidTotal;
  const askTotal = ob.askTotal;
  const total = bidTotal + askTotal;
  const imbalance = total > 0 ? (bidTotal - askTotal) / total : null;

  const book: VnOrderBook = {
    symbol: sym,
    bids: ob.bids,
    asks: ob.asks,
    bidTotal,
    askTotal,
    imbalance,
    lastPrice: ob.lastPrice,
    ceiling: ob.ceiling,
    floor: ob.floor,
    ref: ob.ref,
    session: ob.session,
    eventTime: ob.eventTime,
    levels: Math.max(ob.bids.length, ob.asks.length),
  };

  return {
    book,
    meta: buildMeta({
      source: "ssi-ws",
      sourceTimestampMs: ob.eventTime,
      note: `Sổ lệnh SSI · ${book.levels} mức · kênh X`,
      slas: { liveSlaMs: 15_000, freshSlaMs: 45_000, delayedSlaMs: 120_000 },
    }),
  };
}
