/**
 * REALTIME MARKET STORE — unified, in-process quote store for every asset
 * class (crypto via Binance WS, stocks via the VN engine, forex, commodities).
 *
 *  - Writes: `setQuote()` (quality-validated) or automatic ingestion of
 *    `tick:{SYM}` events emitted by ingestion engines.
 *  - Reads: `get/getMany/snapshot` with honest staleness (STALE_MS per asset).
 *  - Subscribe: per-symbol callbacks; deduped; one callback per symbol.
 *  - Every accepted write emits `market.quote:{SYM}` (typed envelope) so the
 *    SSE gateway can fan out quote updates without polling.
 */

import "server-only";
import { CHANNEL } from "./channels";
import { emitEvent, onAnyEvent } from "./event-envelope";
import { validateQuote, validateBars, logQualityEvent } from "../quality";
import type { ChartCandle } from "../chart-const";
import type { FreshnessStatus, OhlcvBar, QualityStatus } from "../types";

export type StoredAssetType = "stock" | "crypto" | "forex" | "commodity" | "index";

export interface StoredQuote {
  assetType: StoredAssetType;
  symbol: string;
  price: number;
  change?: number | null;
  changePercent?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  volume?: number | null;
  quoteVolume?: number | null;
  referencePrice?: number | null;
  ceilingPrice?: number | null;
  floorPrice?: number | null;
  /** Phase 6 — normalized quote extras (additive) */
  previousClose?: number | null;
  trades24h?: number | null;
  source: string;
  /** provider event time (ms) */
  ts: number;
  /** local ingestion time (ms) */
  ingestedAt: number;
  quality: QualityStatus;
}

/** Phase 6 — one validated candle series per asset+symbol+timeframe. */
export interface StoredCandleSeries {
  timeframe: string;
  intervalMs: number;
  /** limit của series khi được refresh (store chỉ đáp ứng nếu đủ độ dài) */
  limit: number;
  candles: ChartCandle[];
  source: string;
  sourceTimestampMs: number | null;
  ingestedAt: number;
  quality: QualityStatus;
  gaps: number;
  suspect: number;
}

/**
 * Phase 6 — asset-level Realtime Market Store entry (schema §7):
 * `{ quote, candles, source, freshness, quality, updatedAt }`.
 * Key format: `<assetType>:<SYMBOL>` e.g. `crypto:BTCUSDT`, `forex:EURUSD`.
 */
export interface StoredAssetEntry {
  assetType: StoredAssetType;
  symbol: string;
  quote: StoredQuote | null;
  /** keyed by timeframe: "1m" | "5m" | ... | "1M" */
  candles: Record<string, StoredCandleSeries>;
  source: string | null;
  freshness: FreshnessStatus;
  quality: QualityStatus;
  updatedAt: number;
}

const STALE_MS: Record<StoredAssetType, number> = {
  crypto: 20_000,
  stock: 90_000,
  forex: 300_000,
  commodity: 300_000,
  index: 120_000,
};

/** Entry freshness SLA: FRESH ≤ ½ stale-window, DELAYED ≤ stale-window, else STALE. */
export const ENTRY_FRESH_MS: Record<StoredAssetType, number> = {
  crypto: 10_000,
  stock: 45_000,
  forex: 150_000,
  commodity: 150_000,
  index: 60_000,
};

const PRUNE_MS = 30 * 60_000; // drop entries older than this

interface Subscriber {
  symbol: string;
  cb: (q: StoredQuote) => void;
}

/** Worst quality wins: INVALID > SUSPECT > VALID. */
function worstQuality(a: QualityStatus, b: QualityStatus): QualityStatus {
  const rank: Record<QualityStatus, number> = { VALID: 0, SUSPECT: 1, INVALID: 2, STALE: 0 };
  return rank[a] >= rank[b] ? a : b;
}

class MarketStore {
  private quotes = new Map<string, StoredQuote>();
  /** Phase 6 — asset-level entries keyed `<assetType>:<SYMBOL>` */
  private entries = new Map<string, StoredAssetEntry>();
  private subs = new Map<string, Set<Subscriber>>();
  private anyOff: (() => void) | null = null;
  private lastPrune = Date.now();
  private writes = 0;
  private rejected = 0;

  /** Canonical asset-level key: `crypto:BTCUSDT`, `forex:EURUSD`. */
  static key(assetType: StoredAssetType, symbol: string): string {
    return `${assetType}:${symbol.toUpperCase()}`;
  }

  private entryKey(assetType: StoredAssetType, symbol: string): string {
    return MarketStore.key(assetType, symbol);
  }

  private entryFreshness(e: StoredAssetEntry, now = Date.now()): FreshnessStatus {
    const age = now - e.updatedAt;
    if (e.quote == null && Object.keys(e.candles).length === 0) return "UNAVAILABLE";
    const freshSla = ENTRY_FRESH_MS[e.assetType] ?? 150_000;
    const staleSla = STALE_MS[e.assetType] ?? 300_000;
    if (age <= freshSla) return "FRESH";
    if (age <= staleSla) return "DELAYED";
    return "STALE";
  }

  /** Auto-ingest `tick:{SYM}` events — envelopes or legacy raw ticks. */
  attach(): void {
    if (this.anyOff) return;
    this.anyOff = onAnyEvent((e) => {
      const isEnvelope = typeof e?.type === "string" && "payload" in (e as unknown as Record<string, unknown>);
      if (isEnvelope) {
        if (e.type === "tick" && e.symbol) this.ingestTick({ symbol: e.symbol, assetType: e.assetType, payload: e.payload as never });
        return;
      }
      // legacy raw tick payload
      const raw = e as { symbol?: string; price?: number; cumVolume?: number; cumQuoteVolume?: number; ts?: number };
      if (raw?.symbol && typeof raw.price === "number") {
        this.ingestTick({ symbol: raw.symbol, assetType: "crypto", payload: { price: raw.price, cumVolume: raw.cumVolume ?? 0, cumQuoteVolume: raw.cumQuoteVolume ?? 0, ts: raw.ts ?? Date.now() } });
      }
    });
  }

  /**
   * Validate + store a quote, then emit `market.quote:{SYM}`.
   * Returns false (and logs) when the payload is INVALID.
   */
  setQuote(input: Omit<StoredQuote, "ingestedAt" | "quality">): boolean {
    const q = validateQuote(
      {
        price: input.price,
        open: input.open ?? null,
        high: input.high ?? null,
        low: input.low ?? null,
        volume: input.volume ?? 0,
        changePercent: input.changePercent ?? null,
        updatedAt: new Date(input.ts).toISOString(),
      },
      {
        assetClass: input.assetType,
        staleMs: STALE_MS[input.assetType] ?? 300_000,
        sourceTimestampMs: input.ts,
      },
    );
    if (q.status === "INVALID") {
      this.rejected += 1;
      void logQualityEvent("market-store", `quote:${input.symbol}`, q);
      return false;
    }
    const stored: StoredQuote = { ...input, ingestedAt: Date.now(), quality: q.status };
    this.quotes.set(input.symbol.toUpperCase(), stored);
    // Phase 6 — write-through into asset-level entry
    const ek = this.entryKey(input.assetType, input.symbol);
    let entry = this.entries.get(ek);
    if (!entry) {
      entry = { assetType: input.assetType, symbol: input.symbol.toUpperCase(), quote: null, candles: {}, source: null, freshness: "UNAVAILABLE", quality: "VALID", updatedAt: 0 };
      this.entries.set(ek, entry);
    }
    entry.quote = stored;
    entry.source = stored.source;
    entry.quality = worstQuality(entry.quality, stored.quality);
    entry.updatedAt = Date.now();
    entry.freshness = this.entryFreshness(entry);
    this.writes += 1;
    this.prune();
    emitEvent(CHANNEL.quote(input.symbol), "quote", stored, {
      assetType: input.assetType,
      symbol: input.symbol,
      ts: input.ts,
    });
    const set = this.subs.get(input.symbol.toUpperCase());
    if (set) for (const s of set) {
      try {
        s.cb(stored);
      } catch {
        /* isolated subscriber */
      }
    }
    return true;
  }

  /** Ingest `tick:{SYM}` → minimal quote (price + volume accumulators). */
  private ingestTick(e: { symbol: string; assetType: string | null; payload: { price: number; cumVolume?: number; cumQuoteVolume?: number; ts: number } }): void {
    const p = e.payload;
    const sym = e.symbol.toUpperCase();
    if (!Number.isFinite(p?.price) || p.price <= 0) return;
    // Don't overwrite richer engine quotes (VN stock/index) with a bare tick —
    // the tick ingestion is the default writer for tick-only sources (crypto).
    const existing = this.quotes.get(sym);
    if (existing && existing.source !== "event-bus:tick") {
      const staleMs = STALE_MS[existing.assetType] ?? 300_000;
      if (Date.now() - existing.ingestedAt < staleMs) return;
    }
    this.setQuote({
      assetType: (e.assetType as StoredAssetType) ?? "crypto",
      symbol: e.symbol,
      price: p.price,
      volume: p.cumVolume ?? null,
      quoteVolume: p.cumQuoteVolume ?? null,
      source: "event-bus:tick",
      ts: p.ts ?? Date.now(),
    });
  }

  /* ----------------------- Phase 6 asset-level API ------------------------- */

  /** `getEntry("crypto","BTCUSDT")` → `{quote, candles, source, freshness, quality, updatedAt}`. */
  getEntry(assetType: StoredAssetType, symbol: string): StoredAssetEntry | null {
    const e = this.entries.get(this.entryKey(assetType, symbol));
    if (!e) return null;
    e.freshness = this.entryFreshness(e);
    return e;
  }

  /** Quote from the asset-level entry (null if none / unavailable). */
  getQuote(assetType: StoredAssetType, symbol: string): StoredQuote | null {
    return this.getEntry(assetType, symbol)?.quote ?? null;
  }

  /**
   * Store a validated candle series (Phase 6 §8: invalid OHLC / NaN / Infinity /
   * high<low / dupes / out-of-order are sanitized; INVALID → rejected, log).
   * Returns `false` when the series is unusable (nothing is written).
   */
  setCandles(input: {
    assetType: StoredAssetType;
    symbol: string;
    timeframe: string;
    intervalMs: number;
    limit: number;
    candles: ChartCandle[];
    source: string;
    sourceTimestampMs?: number | null;
    gaps?: number;
    suspect?: number;
  }): boolean {
    const q = validateBars(input.candles as OhlcvBar[]);
    if (q.status === "INVALID") {
      this.rejected += 1;
      void logQualityEvent("market-store", `${input.assetType}:${input.symbol}:${input.timeframe}`, q);
      return false;
    }
    const ek = this.entryKey(input.assetType, input.symbol);
    let entry = this.entries.get(ek);
    if (!entry) {
      entry = { assetType: input.assetType, symbol: input.symbol.toUpperCase(), quote: null, candles: {}, source: null, freshness: "UNAVAILABLE", quality: "VALID", updatedAt: 0 };
      this.entries.set(ek, entry);
    }
    const strict = q.status === "SUSPECT" ? worstQuality(entry.quality, "SUSPECT") : entry.quality;
    entry.candles[input.timeframe] = {
      timeframe: input.timeframe,
      intervalMs: input.intervalMs,
      limit: input.limit,
      candles: q.cleaned as ChartCandle[],
      source: input.source,
      sourceTimestampMs: input.sourceTimestampMs ?? null,
      ingestedAt: Date.now(),
      quality: q.status,
      gaps: input.gaps ?? 0,
      suspect: input.suspect ?? 0,
    };
    entry.source = input.source;
    entry.quality = strict;
    entry.updatedAt = Date.now();
    entry.freshness = this.entryFreshness(entry);
    this.writes += 1;
    return true;
  }

  /** Stored candle series for `assetType:symbol:timeframe` (null nếu chưa có). */
  getCandles(assetType: StoredAssetType, symbol: string, timeframe: string): StoredCandleSeries | null {
    return this.getEntry(assetType, symbol)?.candles[timeframe] ?? null;
  }

  /* ------------------------------ legacy API ------------------------------- */

  get(symbol: string): StoredQuote | null {
    return this.quotes.get(symbol.toUpperCase()) ?? null;
  }

  getMany(symbols: string[]): StoredQuote[] {
    const out: StoredQuote[] = [];
    for (const s of symbols) {
      const q = this.quotes.get(s.toUpperCase());
      if (q) out.push(q);
    }
    return out;
  }

  /** All quotes, optionally filtered by asset type. */
  snapshot(assetType?: StoredAssetType | StoredAssetType[]): StoredQuote[] {
    const filter = assetType == null ? null : Array.isArray(assetType) ? new Set(assetType) : new Set([assetType]);
    const all = [...this.quotes.values()];
    return filter ? all.filter((q) => filter.has(q.assetType)) : all;
  }

  /** Subscribe to one or more symbols (deduped per symbol). */
  subscribe(symbols: string[], cb: (q: StoredQuote) => void): () => void {
    const sub: Subscriber = { symbol: "", cb };
    const offs: (() => void)[] = [];
    for (const sym of new Set(symbols.map((s) => s.toUpperCase()))) {
      let set = this.subs.get(sym);
      if (!set) {
        set = new Set();
        this.subs.set(sym, set);
      }
      const entry = { ...sub, symbol: sym };
      set.add(entry);
      offs.push(() => {
        const s = this.subs.get(sym);
        s?.delete(entry);
        if (s && s.size === 0) this.subs.delete(sym);
      });
    }
    return () => {
      for (const f of offs) f();
    };
  }

  private prune(now = Date.now()): void {
    if (now - this.lastPrune < PRUNE_MS) return;
    this.lastPrune = now;
    for (const [k, q] of this.quotes) {
      if (now - q.ingestedAt > PRUNE_MS) this.quotes.delete(k);
    }
  }

  stats(): { symbols: number; entries: number; writes: number; rejected: number; subs: number } {
    return {
      symbols: this.quotes.size,
      entries: this.entries.size,
      writes: this.writes,
      rejected: this.rejected,
      subs: [...this.subs.values()].reduce((a, s) => a + s.size, 0),
    };
  }

  reset(): void {
    this.quotes.clear();
    this.entries.clear();
    this.subs.clear();
    this.writes = 0;
    this.rejected = 0;
  }
}

const g = globalThis as typeof globalThis & { __orcaMarketStore?: MarketStore };
export const marketStore = g.__orcaMarketStore ?? new MarketStore();
g.__orcaMarketStore = marketStore;
// Auto-ingest tick events produced by engines (Binance WS, VN engine, REST overlay)
marketStore.attach();
