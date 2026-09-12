import "server-only";
import { sql } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { cached, peekStale } from "../cache";
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
  fromLastSession?: boolean;
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

const LIVE_MAX_AGE_MS = 20_000;
const LAST_SESSION_MAX_AGE_MS = 72 * 60 * 60_000; // 72h
let snapshotTablePromise: Promise<boolean> | null = null;

async function ensureSnapshotTable(): Promise<boolean> {
  if (!databaseConfigured()) return false;
  if (!snapshotTablePromise) {
    snapshotTablePromise = db
      .execute(sql`CREATE TABLE IF NOT EXISTS orca_orderbook_snapshots (
        symbol text PRIMARY KEY,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`)
      .then(() => true)
      .catch(() => false);
  }
  return snapshotTablePromise;
}

function cacheKey(sym: string) {
  return `vn:orderbook:last:${sym}`;
}

async function rememberLastBook(sym: string, book: VnOrderBook): Promise<void> {
  const snapshot: VnOrderBook = {
    ...book,
    trades: [],
    tradeBuyVol: 0,
    tradeSellVol: 0,
    tradeTotalVol: 0,
    fromLastSession: true,
  };
  try {
    await cached(cacheKey(sym), {
      ttlMs: LAST_SESSION_MAX_AGE_MS,
      staleMs: LAST_SESSION_MAX_AGE_MS,
      skipCache: true,
      producer: async () => snapshot,
    });
  } catch {
    /* non-fatal */
  }
  try {
    if (await ensureSnapshotTable()) {
      await db.execute(sql`
        INSERT INTO orca_orderbook_snapshots (symbol, payload, updated_at)
        VALUES (${sym}, ${JSON.stringify(snapshot)}::jsonb, now())
        ON CONFLICT (symbol) DO UPDATE SET
          payload = EXCLUDED.payload,
          updated_at = EXCLUDED.updated_at
      `);
    }
  } catch {
    /* best-effort persistence; memory/Redis remain available */
  }
}

async function recallLastBook(sym: string): Promise<VnOrderBook | null> {
  const peek = peekStale<VnOrderBook>(cacheKey(sym));
  if (peek?.value && (peek.value.bids?.length || peek.value.asks?.length)) {
    return { ...peek.value, fromLastSession: true };
  }
  try {
    const r = await cached<VnOrderBook>(cacheKey(sym), {
      ttlMs: LAST_SESSION_MAX_AGE_MS,
      staleMs: LAST_SESSION_MAX_AGE_MS,
      producer: async () => {
        throw new Error("no-orderbook-snapshot");
      },
    });
    if (r.value && (r.value.bids?.length || r.value.asks?.length)) {
      return { ...r.value, fromLastSession: true };
    }
  } catch {
    /* miss */
  }
  try {
    if (await ensureSnapshotTable()) {
      const result = await db.execute(sql`
        SELECT payload
        FROM orca_orderbook_snapshots
        WHERE symbol = ${sym}
          AND updated_at >= now() - interval '72 hours'
        LIMIT 1
      `);
      const row = (result as unknown as { rows?: Array<{ payload?: unknown }> }).rows?.[0];
      if (row?.payload && typeof row.payload === "object") {
        return { ...(row.payload as VnOrderBook), fromLastSession: true };
      }
    }
  } catch {
    /* miss */
  }
  return null;
}

/** Persist a raw SSI depth snapshot for the scheduled session snapshot job. */
export async function persistSsiOrderBookSnapshot(ob: SsiOrderBook): Promise<boolean> {
  const book = toBook(ob.symbol, ob, [], true);
  if (!book || (!book.bids.length && !book.asks.length)) return false;
  await rememberLastBook(ob.symbol, book);
  return true;
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

/**
 * SSI order book — depth only exists on DataHub WS (channel X).
 * Always tries WS (forceEnable) even when SSI_WS_DISABLED=true so Vercel
 * can still fetch a one-shot snapshot for the orderbook API.
 */
export async function getVnOrderBook(
  symbol: string,
): Promise<{ book: VnOrderBook; meta: Meta } | null> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym || !ssiFcConfigured()) return null;

  const inSession = isVnSessionWindow();
  let fromLastSession = false;

  // Force WS for this request — depth is not available via REST
  const eng = ssiWs as typeof ssiWs & { forceEnable?: (on?: boolean) => void };
  try {
    eng.forceEnable?.(true);
    ensureSsiWsStarted();
    ssiWs.watchSymbol(sym);

    // 1) Hot memory
    let ob: SsiOrderBook | null = null;
    try {
      ob = ssiWs.getOrderBook(sym, LIVE_MAX_AGE_MS);
      if (!ob) ob = ssiWs.getQuote(sym, LIVE_MAX_AGE_MS)?.orderBook ?? null;
    } catch {
      ob = null;
    }

    // 2) Wait for first depth tick / last-session snapshot from SSI
    //    Outside session SSI often still pushes last X on SwitchChannel.
    if (!ob) {
        // Keep the first request bounded: SSE continues receiving later ticks,
        // while a slow SSI handshake must not block the Vercel response.
        const waitMs = inSession ? 850 : 1_200;
      try {
        if (typeof ssiWs.waitForOrderBook === "function") {
          ob = await ssiWs.waitForOrderBook(sym, waitMs);
        }
      } catch {
        ob = null;
      }
    }

    // 3) Longer-lived WS memory (same process)
    if (!ob) {
      try {
        ob = ssiWs.getOrderBook(sym, LAST_SESSION_MAX_AGE_MS);
        if (!ob) ob = ssiWs.getQuote(sym, LAST_SESSION_MAX_AGE_MS)?.orderBook ?? null;
        if (ob) fromLastSession = true;
      } catch {
        ob = null;
      }
    } else if (!inSession) {
      const age = Date.now() - ob.eventTime;
      if (age > LIVE_MAX_AGE_MS) fromLastSession = true;
    }

    const trades = fromLastSession ? [] : readTrades(sym);
    let book = toBook(sym, ob, trades, fromLastSession);

    // 4) Persist for next requests / outside session
    if (book && (book.bids.length > 0 || book.asks.length > 0)) {
      void rememberLastBook(sym, book);
    }

    // 5) Redis / memory recall
    if (!book) {
      const recalled = await recallLastBook(sym);
      if (recalled) {
        book = recalled;
        fromLastSession = true;
      }
    }

    if (!book) return null;

    const note = book.fromLastSession
      ? `Sổ lệnh phiên gần nhất · ${book.levels} mức · ${new Date(book.eventTime).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}`
      : `Độ sâu SSI · ${book.levels} mức · ${(book.trades ?? []).length} khớp · live`;

    return {
      book,
      meta: buildMeta({
        source: book.fromLastSession ? "ssi-ws-last-session" : "ssi-ws",
        sourceTimestampMs: book.eventTime,
        note,
        slas: book.fromLastSession
          ? { liveSlaMs: 5_000, freshSlaMs: 60_000, delayedSlaMs: LAST_SESSION_MAX_AGE_MS }
          : { liveSlaMs: 5_000, freshSlaMs: 20_000, delayedSlaMs: 60_000 },
      }),
    };
  } finally {
    eng.forceEnable?.(false);
  }
}
