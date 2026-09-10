import "server-only";
import { buildMeta } from "../freshness";
import { ssiFcConfigured } from "../providers/ssi-fcdata";
import { ensureSsiWsStarted, ssiWs, type SsiOrderBook } from "../realtime/ssi-ws";
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
  /** true = snapshot from previous session (outside continuous matching) */
  fromLastSession: boolean;
}

/** HOSE continuous approx 09:00–11:30 & 13:00–14:45 VN time (with buffer). */
function isVnSessionWindow(d = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = get("weekday");
  if (wd === "Sat" || wd === "Sun") return false;
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const mins = hour * 60 + minute;
  return (mins >= 8 * 60 + 45 && mins <= 11 * 60 + 45) || (mins >= 12 * 60 + 45 && mins <= 15 * 60);
}

/** Live SLA while in session; overnight keep last depth until next open. */
const LIVE_MAX_AGE_MS = 20_000;
const LAST_SESSION_MAX_AGE_MS = 20 * 60 * 60_000; // 20h — covers overnight + weekend start Mon morning edge

function bootSsiLive() {
  if (!ssiFcConfigured()) return;
  if (process.env.SSI_WS_DISABLED === "true") return;
  try {
    ensureSsiWsStarted();
  } catch {
    /* non-fatal */
  }
}

function readTrades(symbol: string): VnTrade[] {
  try {
    return ssiWs.getTrades(symbol, 50).map((t) => ({
      price: t.price,
      volume: t.volume,
      change: t.change,
      changePercent: t.changePercent,
      side: t.side,
      time: t.time,
      eventTime: t.eventTime,
    }));
  } catch {
    return [];
  }
}

function toBook(
  sym: string,
  ob: SsiOrderBook | null,
  trades: VnTrade[],
  fromLastSession: boolean,
): VnOrderBook | null {
  if ((!ob || (ob.bids.length === 0 && ob.asks.length === 0)) && trades.length === 0) {
    return null;
  }
  const bids = ob?.bids ?? [];
  const asks = ob?.asks ?? [];
  const bidTotal = ob?.bidTotal ?? 0;
  const askTotal = ob?.askTotal ?? 0;
  const total = bidTotal + askTotal;
  const tradeBuyVol = trades.filter((t) => t.side === "buy").reduce((s, t) => s + t.volume, 0);
  const tradeSellVol = trades.filter((t) => t.side === "sell").reduce((s, t) => s + t.volume, 0);
  const tradeTotalVol = trades.reduce((s, t) => s + t.volume, 0);

  return {
    symbol: sym,
    bids,
    asks,
    bidTotal,
    askTotal,
    imbalance: total > 0 ? (bidTotal - askTotal) / total : null,
    lastPrice: ob?.lastPrice ?? trades[0]?.price ?? null,
    ceiling: ob?.ceiling ?? null,
    floor: ob?.floor ?? null,
    ref: ob?.ref ?? null,
    session: ob?.session ?? null,
    eventTime: ob?.eventTime ?? trades[0]?.eventTime ?? Date.now(),
    levels: Math.max(bids.length, asks.length),
    trades: fromLastSession ? [] : trades,
    tradeBuyVol: fromLastSession ? 0 : tradeBuyVol,
    tradeSellVol: fromLastSession ? 0 : tradeSellVol,
    tradeTotalVol: fromLastSession ? 0 : tradeTotalVol,
    fromLastSession,
  };
}

export async function getVnOrderBook(
  symbol: string,
): Promise<{ book: VnOrderBook; meta: Meta } | null> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym || !ssiFcConfigured()) return null;

  const inSession = isVnSessionWindow();
  const wsDisabled = process.env.SSI_WS_DISABLED === "true";

  // Even with WS disabled, try in-memory last snapshot (same process that received ticks earlier)
  if (!wsDisabled) bootSsiLive();

  // 1) Fresh live depth
  let ob: SsiOrderBook | null = ssiWs.getOrderBook(sym, LIVE_MAX_AGE_MS);
  if (!ob) {
    const q = ssiWs.getQuote(sym, LIVE_MAX_AGE_MS);
    ob = q?.orderBook ?? null;
  }

  let fromLastSession = false;

  // 2) In session: short event wait for first tick
  if (!ob && !wsDisabled) {
    try {
      ob = await ssiWs.waitForOrderBook(sym, inSession ? 250 : 600);
    } catch {
      ob = null;
    }
  }

  // 3) Outside session / no live tick: use last known depth (up to 20h)
  if (!ob) {
    ob = ssiWs.getOrderBook(sym, LAST_SESSION_MAX_AGE_MS);
    if (!ob) {
      const q = ssiWs.getQuote(sym, LAST_SESSION_MAX_AGE_MS);
      ob = q?.orderBook ?? null;
    }
    if (ob) fromLastSession = true;
  } else if (!inSession) {
    // Still have a "fresh" cache but market is closed → treat as last session for UI labeling
    const age = Date.now() - ob.eventTime;
    if (age > LIVE_MAX_AGE_MS) fromLastSession = true;
  } else {
    ssiWs.watchSymbol(sym);
  }

  // 4) Outside session: one more subscribe attempt — SSI often pushes last X snapshot on SwitchChannel
  if (!ob && !wsDisabled && !inSession) {
    ssiWs.watchSymbol(sym);
    try {
      ob = await ssiWs.waitForOrderBook(sym, 800);
      if (ob) fromLastSession = true;
    } catch {
      /* ignore */
    }
  }

  const trades = fromLastSession ? [] : readTrades(sym);
  const book = toBook(sym, ob, trades, fromLastSession);
  if (!book) return null;

  const ageMs = Date.now() - book.eventTime;
  const note = fromLastSession
    ? `Sổ lệnh phiên gần nhất · ${book.levels} mức · ${new Date(book.eventTime).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}`
    : `Độ sâu SSI · ${book.levels} mức · ${trades.length} khớp · live`;

  return {
    book,
    meta: buildMeta({
      source: fromLastSession ? "ssi-ws-last-session" : "ssi-ws",
      sourceTimestampMs: book.eventTime,
      note,
      slas: fromLastSession
        ? { liveSlaMs: 5_000, freshSlaMs: 60_000, delayedSlaMs: LAST_SESSION_MAX_AGE_MS }
        : { liveSlaMs: 5_000, freshSlaMs: 20_000, delayedSlaMs: 60_000 },
    }),
  };
}
