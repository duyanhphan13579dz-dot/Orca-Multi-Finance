import "server-only";
import { eventBus } from "../events";
import { getBiquotePublicQuotes, type BiquoteTick } from "../providers/forex";

/**
 * Shared Biquote public tick cache + poll loop (Workers-safe REST poll).
 * Core universe: FX majors · XAUUSD · XAGUSD · USOIL/UKOIL · USDVND
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

export const BIQUOTE_CORE_SYMBOLS = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USDCHF",
  "AUDUSD",
  "USDCAD",
  "NZDUSD",
  "EURJPY",
  "GBPJPY",
  "USDVND",
  "XAUUSD",
  "XAGUSD",
  "USOIL",
  "UKOIL",
  "XPTUSD",
] as const;

const ALIASES: Record<string, string> = {
  OILUSD: "USOIL",
  WTIUSD: "USOIL",
  WTI: "USOIL",
  BRENT: "UKOIL",
  BRENTUSD: "UKOIL",
  GOLD: "XAUUSD",
  XAU: "XAUUSD",
  SILVER: "XAGUSD",
  XAG: "XAGUSD",
  PLATINUM: "XPTUSD",
  PALLADIUM: "XPDUSD",
};

const POLL_MS = 1_000;
const STALE_MS = 45_000;
const MAX_BATCH = 24;

const ticks = new Map<string, BiquoteLiveTick>();
const watchers = new Map<string, number>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let inflight = false;
let started = false;
let corePinned = false;

function canon(symbol: string): string {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return ALIASES[s] ?? s;
}

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
  const symbols = [...new Set([...watchers.keys(), ...(corePinned ? BIQUOTE_CORE_SYMBOLS : [])])]
    .map(canon)
    .filter(Boolean)
    .slice(0, MAX_BATCH);
  if (!symbols.length) return;
  inflight = true;
  try {
    const { ticks: batch } = await getBiquotePublicQuotes(symbols);
    const now = Date.now();
    for (const [sym, t] of Object.entries(batch)) {
      const live = toLive(t);
      ticks.set(sym, live);
      for (const [alias, target] of Object.entries(ALIASES)) {
        if (target === sym) ticks.set(alias, { ...live, symbol: alias });
      }
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
  if (
    process.env.CLOUDFLARE_WORKERS === "1" ||
    process.env.NEXT_RUNTIME === "edge" ||
    process.env.BIQUOTE_POLL_DISABLED === "true"
  ) {
    // Cloudflare Workers limit subrequests and CPU; avoid persistent setInterval in isolate
    void pollOnce();
    return;
  }
  pollTimer = setInterval(() => {
    void pollOnce();
  }, POLL_MS);
  pollTimer.unref?.();
  void pollOnce();
}

function stopLoopIfIdle(): void {
  if (watchers.size > 0 || corePinned) return;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function ensureBiquotePollStarted(): void {
  started = true;
  ensureLoop();
}

export function ensureBiquoteCoreWatch(): void {
  corePinned = true;
  for (const s of BIQUOTE_CORE_SYMBOLS) {
    watchers.set(s, Math.max(watchers.get(s) ?? 0, 1));
  }
  ensureBiquotePollStarted();
  ensureLoop();
}

export function watchBiquoteSymbol(symbol: string): () => void {
  const sym = canon(symbol);
  if (!sym) return () => {};
  watchers.set(sym, (watchers.get(sym) ?? 0) + 1);
  ensureBiquotePollStarted();
  ensureLoop();
  return () => {
    const n = (watchers.get(sym) ?? 1) - 1;
    if (n <= 0) {
      if (!corePinned || !(BIQUOTE_CORE_SYMBOLS as readonly string[]).includes(sym)) {
        watchers.delete(sym);
      } else {
        watchers.set(sym, 1);
      }
    } else watchers.set(sym, n);
    stopLoopIfIdle();
  };
}

export function getBiquoteLiveTick(symbol: string, maxAgeMs = STALE_MS): BiquoteLiveTick | null {
  const sym = canon(symbol);
  const t = ticks.get(sym) ?? ticks.get(symbol.toUpperCase());
  if (!t) return null;
  if (Date.now() - t.ts > maxAgeMs) return null;
  return t;
}

export function getBiquoteLiveTickAny(symbol: string): BiquoteLiveTick | null {
  const sym = canon(symbol);
  return ticks.get(sym) ?? ticks.get(symbol.toUpperCase()) ?? null;
}

export function getBiquoteLiveAll(maxAgeMs = STALE_MS): BiquoteLiveTick[] {
  const now = Date.now();
  const out: BiquoteLiveTick[] = [];
  for (const t of ticks.values()) {
    if (now - t.ts <= maxAgeMs) out.push(t);
  }
  const seen = new Set<string>();
  return out.filter((t) => {
    if (seen.has(t.symbol)) return false;
    seen.add(t.symbol);
    return true;
  });
}

export function biquoteWatchedSymbols(): string[] {
  return [...watchers.keys()];
}

export function isBiquotePollActive(): boolean {
  return started && pollTimer != null;
}
