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
import { validateQuote, logQualityEvent } from "../quality";
import type { QualityStatus } from "../types";

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
  source: string;
  /** provider event time (ms) */
  ts: number;
  /** local ingestion time (ms) */
  ingestedAt: number;
  quality: QualityStatus;
}

const STALE_MS: Record<StoredAssetType, number> = {
  crypto: 20_000,
  stock: 90_000,
  forex: 300_000,
  commodity: 300_000,
  index: 120_000,
};

const PRUNE_MS = 30 * 60_000; // drop entries older than this

interface Subscriber {
  symbol: string;
  cb: (q: StoredQuote) => void;
}

class MarketStore {
  private quotes = new Map<string, StoredQuote>();
  private subs = new Map<string, Set<Subscriber>>();
  private anyOff: (() => void) | null = null;
  private lastPrune = Date.now();
  private writes = 0;
  private rejected = 0;

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

  stats(): { symbols: number; writes: number; rejected: number; subs: number } {
    return { symbols: this.quotes.size, writes: this.writes, rejected: this.rejected, subs: [...this.subs.values()].reduce((a, s) => a + s.size, 0) };
  }

  reset(): void {
    this.quotes.clear();
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
