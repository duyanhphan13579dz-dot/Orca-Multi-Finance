/**
 * VIETNAM MARKET DATA ENGINE (Phase 1) — session-aware realtime poller.
 *
 *  - Cadence adapts to the VN session engine: 10s during continuous trading,
 *    30s at ATC/post-trading, 60s during pre-open/lunch, stopped after close
 *    (with one final poll to capture official closing prices).
 *  - Single-flight: concurrent triggers never overlap; poll jumps are skipped.
 *  - Writes validated quotes into the unified Realtime Market Store.
 *  - Emits typed `tick:{SYM}` events + `vn.index.updated` (index snapshot).
 *  - Feeds 1m base bars into the Multi-timeframe Candle Engine (live bars when
 *    polling; daily REST history seeds only the daily view via seedTf).
 *
 * Inert by default — started on demand by the SSE gateway / explicit start().
 */

import "server-only";
import { marketStore } from "./market-store";
import { multiTfCandles } from "./multi-tf-candles";
import { CHANNEL } from "./channels";
import { emitEvent } from "./event-envelope";
import { getVnSession, type VnSessionInfo, type VnSessionState } from "../vn/sessions";
import * as vnstock from "../providers/vnstock";
import * as vndirect from "../providers/vndirect";
import type { IndexQuote, Quote } from "../types";

export interface VnQuoteInput {
  symbol: string;
  price: number;
  change?: number | null;
  changePercent?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  volume?: number | null;
  referencePrice?: number | null;
  ceilingPrice?: number | null;
  floorPrice?: number | null;
  ts?: number;
}

interface VnBar {
  bucket: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  lastVol: number | null;
}

const CADENCE_MS: Record<VnSessionState, number | null> = {
  morning_continuous: 10_000,
  afternoon_continuous: 10_000,
  opening_auction: 15_000,
  closing_auction: 30_000,
  post_trading: 30_000,
  pre_open: 60_000,
  lunch_break: 60_000,
  weekend_closed: null,
  holiday_closed: null,
  closed: null,
};

class VnMarketDataEngine {
  private symbols = new Set<string>();
  private bars = new Map<string, VnBar>();
  private indices: IndexQuote[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<void> | null = null;
  private lastState: VnSessionState | null = null;
  private finalPollDone = false;
  private pollCount = 0;
  private startTs = 0;
  private lastError: string | null = null;
  private active = false;

  enabled(): boolean {
    // Always enabled: VNDirect fallback works without an API key.
    return true;
  }

  /** Start polling for a fixed symbol set (idempotent, union of symbols). */
  start(symbols: string[]): void {
    for (const s of symbols) this.symbols.add(s.toUpperCase());
    if (!this.active) {
      this.active = true;
      this.startTs = Date.now();
      void this.pollSafe();
      this.scheduleNext();
    } else {
      this.scheduleNext(); // react to session state
    }
  }

  stop(): void {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  addSymbols(symbols: string[]): void {
    this.start(symbols);
  }

  /** One poll immediately (used by gateway snapshot refresh). */
  async pollNow(): Promise<boolean> {
    if (!this.active || this.symbols.size === 0) return false;
    try {
      await this.poll();
      return true;
    } catch {
      return false;
    }
  }

  private scheduleNext(): void {
    if (!this.active) return;
    if (this.timer) clearTimeout(this.timer);
    const s = getVnSession();
    this.lastState = s.state;
    const cadence = CADENCE_MS[s.state];
    if (cadence == null) {
      // Terminal state: one last poll to capture official closing prices.
      if (!this.finalPollDone) {
        this.finalPollDone = true;
        void this.pollSafe().finally(() => this.stop());
      } else this.stop();
      return;
    }
    this.finalPollDone = false;
    const delay = cadence + Math.random() * 800;
    this.timer = setTimeout(() => void this.pollSafe().then(() => this.scheduleNext()), delay);
    this.timer.unref?.();
  }

  private async pollSafe(): Promise<void> {
    if (this.inflight) return this.inflight;
    try {
      this.inflight = this.poll();
      await this.inflight;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : "poll failed";
    } finally {
      this.inflight = null;
    }
  }

  /** Single-flight poll: VNStock primary → VNDirect fallback. */
  private async poll(): Promise<void> {
    const syms = [...this.symbols];
    if (!syms.length) return;
    interface Res {
      quotes: Quote[];
      indices: IndexQuote[];
    }
    let res: Res | null = null;
    try {
      const q = await vnstock.getVnQuotes(syms);
      const idx = await vnstock.getVnIndices().catch(() => ({ items: [] as IndexQuote[], sourceTs: Date.now() }));
      res = { quotes: q, indices: idx.items };
    } catch {
      const q = await vndirect.getVndQuotes(syms);
      res = { quotes: q.quotes, indices: [] };
    }
    if (!res) throw new Error("both vn providers failed");

    const now = Date.now();
    for (const quote of res.quotes) {
      const input: VnQuoteInput = {
        symbol: quote.symbol,
        price: quote.price,
        change: quote.change ?? null,
        changePercent: quote.changePercent ?? null,
        open: quote.open ?? null,
        high: quote.high ?? null,
        low: quote.low ?? null,
        volume: quote.volume ?? null,
        referencePrice: quote.referencePrice ?? null,
        ceilingPrice: quote.ceilingPrice ?? null,
        floorPrice: quote.floorPrice ?? null,
        ts: quote.updatedAt ? Date.parse(quote.updatedAt) || now : now,
      };
      this.ingestQuote(input);
    }

    // Index snapshot → typed event + store
    if (res.indices.length) {
      this.indices = res.indices;
      for (const idx of res.indices) {
        marketStore.setQuote({
          assetType: "index",
          symbol: idx.code,
          price: idx.value,
          change: idx.change ?? null,
          changePercent: idx.changePercent ?? null,
          volume: idx.volume ?? null,
          source: "vn-market-engine",
          ts: idx.updatedAt ? Date.parse(idx.updatedAt) || now : now,
        });
      }
      emitEvent(CHANNEL.vnIndex, "vn.index", { items: res.indices, session: getVnSession(), checkedAt: new Date().toISOString() }, { assetType: "index", ts: now });
    }
    this.pollCount += 1;
    this.lastError = null;
  }

  /** Validate → store → tick event → 1m base candle frame. */
  ingestQuote(input: VnQuoteInput): void {
    const sym = input.symbol.toUpperCase();
    const ts = input.ts ?? Date.now();
    const ok = marketStore.setQuote({
      assetType: "stock",
      symbol: sym,
      price: input.price,
      change: input.change ?? null,
      changePercent: input.changePercent ?? null,
      open: input.open ?? null,
      high: input.high ?? null,
      low: input.low ?? null,
      volume: input.volume ?? null,
      referencePrice: input.referencePrice ?? null,
      ceilingPrice: input.ceilingPrice ?? null,
      floorPrice: input.floorPrice ?? null,
      source: "vn-market-engine",
      ts,
    });
    if (!ok) return; // INVALID dropped + logged by store

    emitEvent(CHANNEL.tick(sym), "tick", { symbol: sym, price: input.price, cumVolume: input.volume ?? 0, cumQuoteVolume: 0, ts }, { assetType: "stock", symbol: sym, ts });

    // 1m base candle (volume = delta of the provider cumulative counter)
    const bucket = Math.floor(ts / 60_000) * 60_000;
    let bar = this.bars.get(sym);
    const vol = input.volume ?? 0;
    const delta = bar?.lastVol == null ? 0 : vol >= bar.lastVol ? vol - bar.lastVol : vol;
    if (bar && bar.bucket !== bucket) {
      multiTfCandles.applyBaseFrame(sym, this.toFrame(bar, true));
      bar = undefined;
    }
    if (!bar) {
      bar = { bucket, open: input.price, high: input.price, low: input.price, close: input.price, volume: delta, lastVol: vol };
      this.bars.set(sym, bar);
    } else {
      bar.high = Math.max(bar.high, input.price);
      bar.low = Math.min(bar.low, input.price);
      bar.close = input.price;
      bar.volume += delta;
      bar.lastVol = vol;
    }
    multiTfCandles.applyBaseFrame(sym, this.toFrame(bar, false));
  }

  private toFrame(bar: VnBar, closed: boolean): {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    closed: boolean;
    transport: string;
    quality: string;
  } {
    return {
      time: bar.bucket,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      closed,
      transport: "vn-market-engine:1m",
      quality: "VALID",
    };
  }

  /** Seed daily REST history into the daily tf (intraday tfs are live-only). */
  async seedDaily(symbol: string, bars: { time: number; open: number; high: number; low: number; close: number; volume: number }[]): Promise<void> {
    multiTfCandles.seedTf(symbol.toUpperCase(), "1d", bars);
  }

  session(): VnSessionInfo {
    return getVnSession();
  }

  stats(): { active: boolean; symbols: number; pollCount: number; lastError: string | null; startTs: number } {
    return { active: this.active, symbols: this.symbols.size, pollCount: this.pollCount, lastError: this.lastError, startTs: this.startTs };
  }
}

const g = globalThis as typeof globalThis & { __orcaVnEngine?: VnMarketDataEngine };
export const vnMarketEngine = g.__orcaVnEngine ?? new VnMarketDataEngine();
g.__orcaVnEngine = vnMarketEngine;
