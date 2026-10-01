import "server-only";
import { eventBus } from "../events";
import { getBiquotePublicQuotes, type BiquoteTick } from "../providers/forex";

/**
 * Shared Biquote public tick cache + poll loop.
 *
 * Why poll instead of SignalR on the server?
 * - Vercel serverless cannot keep long-lived SignalR connections across requests
 *   (same policy as BINANCE_WS / VNDIRECT_WS via ws-policy).
 * - Public REST `/api/latest` is free, no key, and batches many symbols.
 * - Chart SSE clients receive ticks via eventBus after each poll (~1.2s).
 *
 * Client browsers may still connect directly to `https://biquote.io/hubs/tick`
 * (SignalR) if desired; this module is the server-side live feed for Orca.
 */

export interface BiquoteLiveTick {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  high: number | null;
  low: number | null;
  dayDiffPercent: number | null;
  ts: number;
  marketState: string;
  source: "biquote-public";
}

const POLL_MS = 1_200;
const STALE_MS = 30_000;

const ticks = new Map<string, BiquoteLiveTick>();
const watchers = new Map<string, number>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let inflight = false;
let started = false;

function toLive(t: BiquoteTick): BiquoteLiveTick {
  return {
    symbol: t.symbol,
    price: t.mid,
    bid: t.bid,
    ask: t.ask,
    high: t.high,
    low: t.low,
    dayDiffPercent: t.dayDiffPercent,
    ts: t.timestamp,
    marketState: t.marketState,
    source: "biquote-public",
  };
}

async function pollOnce(): Promise<void> {
  if (inflight) return;
  const symbols = [...watchers.keys()];
  if (!symbols.length) return;
  inflight = true;
  try {
    const { ticks: batch } = await getBiquotePublicQuotes(symbols);
    const now = Date.now();
    for (const [sym, t] of Object.entries(batch)) {
      const live = toLive(t);
      ticks.set(sym, live);
      eventBus.emit(`market-tick:${sym}`, {
        symbol: sym,
        price: live.price,
        cumVolume: 0,
        cumQuoteVolume: 0,
        ts: live.ts || now,
        source: "biquote",
        degraded: false,
      });
    }
  } catch {
    /* keep last known */
  } finally {
    inflight = false;
  }
}

function ensureLoop(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    void pollOnce();
  }, POLL_MS);
  pollTimer.unref?.();
  void pollOnce();
}

function stopLoopIfIdle(): void {
  if (watchers.size > 0) return;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function ensureBiquotePollStarted(): void {
  started = true;
  ensureLoop();
}

export function watchBiquoteSymbol(symbol: string): () => void {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return () => {};
  watchers.set(sym, (watchers.get(sym) ?? 0) + 1);
  ensureBiquotePollStarted();
  ensureLoop();
  return () => {
    const n = (watchers.get(sym) ?? 1) - 1;
    if (n <= 0) watchers.delete(sym);
    else watchers.set(sym, n);
    stopLoopIfIdle();
  };
}

export function getBiquoteLiveTick(symbol: string, maxAgeMs = STALE_MS): BiquoteLiveTick | null {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const t = ticks.get(sym);
  if (!t) return null;
  if (Date.now() - t.ts > maxAgeMs) return null;
  return t;
}

export function getBiquoteLiveTickAny(symbol: string): BiquoteLiveTick | null {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return ticks.get(sym) ?? null;
}

export function biquoteWatchedSymbols(): string[] {
  return [...watchers.keys()];
}

export function isBiquotePollActive(): boolean {
  return started && pollTimer != null;
}
