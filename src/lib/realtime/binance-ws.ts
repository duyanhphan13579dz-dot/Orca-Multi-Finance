import "server-only";
import { recordFailure, recordSuccess } from "../health";
import { eventBus } from "../events";

/**
 * CENTRALIZED BINANCE WEBSOCKET INGESTION ENGINE
 *
 * One shared connection for the whole platform (never per-user):
 *   wss://stream.binance.com  !ticker@arr      → spot realtime store
 *   wss://fstream.binance.com !markPrice@arr   → futures marks/funding store
 *
 * Validation + normalization happens at ingestion; invalid messages are
 * dropped and logged. When the stream is geo-blocked/unreachable the engine
 * backs off, keeps retrying slowly, and the REST pipeline remains the source
 * of truth — status is always exposed at /system.
 */

export interface WsTicker {
  symbol: string;
  price: number;
  changePercent: number;
  volume: number;
  quoteVolume: number;
  eventTime: number;
}

export interface WsMark {
  symbol: string;
  markPrice: number;
  fundingRate: number;
  eventTime: number;
}

export interface StreamStats {
  state: "open" | "connecting" | "closed" | "blocked" | "disabled" | "retrying";
  connectedAt: number | null;
  lastMessageAt: number | null;
  messagesPerMin: number;
  reconnectAttempts: number;
  lastError: string | null;
}

export interface RealtimeStats {
  enabled: boolean;
  spot: StreamStats;
  futures: StreamStats;
  kline: StreamStats;
  klineStreams: number;
  tickersTracked: number;
  marksTracked: number;
}

/** Binance-supported kline intervals */
export const KLINE_INTERVALS = new Set(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"]);

export interface KlineCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: boolean;
}

const SPOT_URL = process.env.BINANCE_WS_SPOT_URL ?? "wss://stream.binance.com:9443/stream?streams=!ticker@arr";
const FUT_URL = process.env.BINANCE_WS_FUT_URL ?? "wss://fstream.binance.com/stream?streams=!markPrice@arr";
const SPOT_PROVIDER = "binance-ws:spot";
const FUT_PROVIDER = "binance-ws:futures";

interface PrivStats {
  state: StreamStats["state"];
  connectedAt: number | null;
  lastMessageAt: number | null;
  window: number[];
  reconnectAttempts: number;
  lastError: string | null;
}

const newStats = (): PrivStats => ({
  state: "connecting",
  connectedAt: null,
  lastMessageAt: null,
  window: [],
  reconnectAttempts: 0,
  lastError: null,
});

type WsLike = {
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onclose: ((e: { code?: number; reason?: string }) => void) | null;
  close: () => void;
};

class BinanceRealtimeEngine {
  private started = false;
  private tickers = new Map<string, WsTicker>();
  private marks = new Map<string, WsMark>();
  private spot: PrivStats = newStats();
  private fut: PrivStats = newStats();
  private kline: PrivStats = newStats();
  private klineRefs = new Map<string, number>(); // "SYM@interval" → refs
  private klineWs: WsLike | null = null;
  private klineRebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private spotWs: WsLike | null = null;
  private futWs: WsLike | null = null;
  private spotTimer: ReturnType<typeof setTimeout> | null = null;
  private futTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;

  /**
   * CENTRALIZED KLINE SUBSCRIPTION MANAGER — one shared aggregated connection
   * for all (symbol, interval) keys, refcounted. Returns an unsubscribe fn.
   * Emits `kline:{SYM}:{interval}` on the event bus with validated bars
   * (closed flag = Binance k.x). When the region blocks WS, the stream stays
   * "blocked" honestly and the REST/tick pipeline keeps feeding candles.
   */
  requestKline(symbol: string, interval: string): () => void {
    if (!this.enabled() || !KLINE_INTERVALS.has(interval)) return () => {};
    this.start();
    const sym = symbol.toUpperCase();
    const key = `${sym}@${interval}`;
    this.klineRefs.set(key, (this.klineRefs.get(key) ?? 0) + 1);
    this.scheduleKlineRebuild();
    return () => {
      const n = (this.klineRefs.get(key) ?? 0) - 1;
      if (n <= 0) this.klineRefs.delete(key);
      else this.klineRefs.set(key, n);
      this.scheduleKlineRebuild();
    };
  }

  klineKeys(): string[] {
    return [...this.klineRefs.keys()];
  }

  private scheduleKlineRebuild() {
    if (this.klineRebuildTimer) clearTimeout(this.klineRebuildTimer);
    this.klineRebuildTimer = setTimeout(() => this.rebuildKlineStream(), 350);
    this.klineRebuildTimer.unref?.();
  }

  private rebuildKlineStream() {
    try {
      this.klineWs?.close();
    } catch {
      /* noop */
    }
    this.klineWs = null;
    const keys = [...this.klineRefs.keys()];
    if (!keys.length) {
      this.kline.state = "closed";
      return;
    }
    const WSImpl = (globalThis as { WebSocket?: new (url: string) => WsLike }).WebSocket;
    if (!WSImpl) {
      this.kline.state = "disabled";
      return;
    }
    const streams = keys.map((k) => {
      const [sym, tf] = k.split("@");
      return `${sym.toLowerCase()}@kline_${tf}`;
    });
    const url = `wss://stream.binance.com:9443/stream?streams=${streams.join("/")}`;
    try {
      this.kline.state = "connecting";
      const ws = new WSImpl(url);
      this.klineWs = ws;
      ws.onopen = () => {
        this.kline.state = "open";
        this.kline.connectedAt = Date.now();
        this.kline.lastError = null;
        recordSuccess("binance-ws:kline", 0);
      };
      ws.onmessage = (e) => {
        this.kline.lastMessageAt = Date.now();
        this.kline.window.push(this.kline.lastMessageAt);
        if (this.kline.window.length > 2000) this.kline.window.splice(0, this.kline.window.length - 2000);
        try {
          const msg = JSON.parse(String(e.data)) as { stream?: string; data?: Record<string, unknown> };
          const k = msg.data?.k as Record<string, unknown> | undefined;
          if (!k || typeof k.s !== "string" || typeof k.i !== "string") return;
          const sym = k.s;
          const tf = k.i;
          const time = Number(k.t);
          const open = Number(k.o);
          const high = Number(k.h);
          const low = Number(k.l);
          const close = Number(k.c);
          if (!Number.isFinite(time) || open <= 0 || high < low || close <= 0) return; // validation
          const candle: KlineCandle = {
            time, open, high, low, close,
            volume: Number(k.v) || 0,
            closed: Boolean(k.x),
          };
          eventBus.emit(`kline:${sym}:${tf}`, { symbol: sym, timeframe: tf, candle });
        } catch {
          /* malformed frame */
        }
      };
      ws.onerror = (e) => {
        this.kline.lastError = wsErrorMessage(e);
      };
      ws.onclose = (e) => {
        this.kline.state = this.kline.lastError ? "blocked" : "closed";
        recordFailure("binance-ws:kline", this.kline.lastError ?? `close ${e.code ?? ""}`);
        // reconnect while there are active subscriptions (bounded backoff)
        if (this.klineRefs.size) {
          const st = this.kline;
          st.reconnectAttempts += 1;
          const delay = Math.min(2000 * 2 ** Math.min(st.reconnectAttempts, 5), 30_000) + Math.random() * 1000;
          st.state = "retrying";
          setTimeout(() => {
            if (this.klineRefs.size) this.rebuildKlineStream();
          }, delay).unref?.();
        }
      };
    } catch (err) {
      this.kline.lastError = err instanceof Error ? err.message : "kline connect failed";
      this.kline.state = "blocked";
      recordFailure("binance-ws:kline", this.kline.lastError);
    }
  }

  enabled(): boolean {
    return (process.env.BINANCE_WS_ENABLED ?? "true").toLowerCase() !== "false";
  }

  start() {
    if (this.started || !this.enabled()) return;
    this.started = true;
    const WSImpl = (globalThis as { WebSocket?: new (url: string) => WsLike }).WebSocket;
    if (!WSImpl) {
      this.spot.state = "disabled";
      this.fut.state = "disabled";
      this.spot.lastError = this.fut.lastError = "no native WebSocket in runtime";
      return;
    }
    this.connect("spot", SPOT_URL);
    this.connect("futures", FUT_URL);
    this.watchdog = setInterval(() => this.checkLiveness(), 15_000);
    this.watchdog.unref?.();
  }

  private stats(kind: "spot" | "futures"): PrivStats {
    return kind === "spot" ? this.spot : this.fut;
  }

  private connect(kind: "spot" | "futures", url: string) {
    const st = this.stats(kind);
    const provider = kind === "spot" ? SPOT_PROVIDER : FUT_PROVIDER;
    const WSImpl = (globalThis as { WebSocket?: new (url: string) => WsLike }).WebSocket;
    if (!WSImpl) return;
    try {
      st.state = "connecting";
      const ws = new WSImpl(url);
      if (kind === "spot") this.spotWs = ws;
      else this.futWs = ws;

      ws.onopen = () => {
        st.state = "open";
        st.connectedAt = Date.now();
        st.reconnectAttempts = 0;
        st.lastError = null;
        recordSuccess(provider, 0);
      };
      ws.onmessage = (e) => {
        st.lastMessageAt = Date.now();
        st.window.push(st.lastMessageAt);
        if (st.window.length > 4000) st.window.splice(0, st.window.length - 4000);
        try {
          const parsed = JSON.parse(String(e.data)) as { stream?: string; data?: unknown };
          if (kind === "spot") this.ingestTickers(parsed.data);
          else this.ingestMarks(parsed.data);
        } catch {
          /* malformed frame — drop */
        }
      };
      ws.onerror = (e) => {
        st.lastError = wsErrorMessage(e);
      };
      ws.onclose = (e) => {
        st.state = st.lastError ? "blocked" : "closed";
        const msg = st.lastError ?? `close ${e.code ?? ""} ${e.reason ?? ""}`.trim();
        recordFailure(provider, msg);
        this.scheduleReconnect(kind, url);
      };
    } catch (err) {
      st.lastError = err instanceof Error ? err.message : "connect failed";
      st.state = "blocked";
      recordFailure(provider, st.lastError);
      this.scheduleReconnect(kind, url);
    }
  }

  private scheduleReconnect(kind: "spot" | "futures", url: string) {
    const st = this.stats(kind);
    st.reconnectAttempts += 1;
    const base = st.reconnectAttempts <= 4 ? Math.min(2000 * 2 ** st.reconnectAttempts, 20_000) : 60_000;
    const delay = base + Math.random() * 1500;
    st.state = "retrying";
    const timer = setTimeout(() => this.connect(kind, url), delay);
    timer.unref?.();
    if (kind === "spot") this.spotTimer = timer;
    else this.futTimer = timer;
  }

  private checkLiveness() {
    const now = Date.now();
    for (const kind of ["spot", "futures"] as const) {
      const st = this.stats(kind);
      if (st.state === "open" && st.lastMessageAt && now - st.lastMessageAt > 45_000) {
        st.lastError = "stream silent > 45s — reconnect";
        try {
          (kind === "spot" ? this.spotWs : this.futWs)?.close();
        } catch {
          /* force path through onclose */
          this.scheduleReconnect(kind, kind === "spot" ? SPOT_URL : FUT_URL);
        }
      }
    }
  }

  /* ------------------------------- ingestion ------------------------------ */

  private ingestTickers(data: unknown) {
    if (!Array.isArray(data)) return;
    for (const raw of data) {
      const r = raw as Record<string, unknown>;
      const symbol = typeof r.s === "string" ? r.s : null;
      const price = Number(r.c);
      const changePercent = Number(r.P);
      const eventTime = Number(r.E);
      if (!symbol || !Number.isFinite(price) || price <= 0 || !Number.isFinite(eventTime)) continue;
      if (eventTime > Date.now() + 60_000 || eventTime < Date.now() - 600_000) continue; // timestamp sanity
      this.tickers.set(symbol, {
        symbol,
        price,
        changePercent: Number.isFinite(changePercent) ? changePercent : 0,
        volume: Number(r.v) || 0,
        quoteVolume: Number(r.q) || 0,
        eventTime,
      });
      // central event bus → candle aggregation engine (only when subscribed)
      eventBus.emit(`tick:${symbol}`, {
        symbol,
        price,
        cumVolume: Number(r.v) || 0,
        cumQuoteVolume: Number(r.q) || 0,
        ts: eventTime,
      });
    }
  }

  private ingestMarks(data: unknown) {
    if (!Array.isArray(data)) return;
    for (const raw of data) {
      const r = raw as Record<string, unknown>;
      const symbol = typeof r.s === "string" ? r.s : null;
      const markPrice = Number(r.p);
      const eventTime = Number(r.E);
      if (!symbol || !Number.isFinite(markPrice) || markPrice <= 0 || !Number.isFinite(eventTime)) continue;
      this.marks.set(symbol, {
        symbol,
        markPrice,
        fundingRate: Number.isFinite(Number(r.r)) ? Number(r.r) : 0,
        eventTime,
      });
    }
  }

  /* -------------------------------- accessors ----------------------------- */

  getTickers(maxAgeMs = 15_000): Map<string, WsTicker> {
    const now = Date.now();
    const out = new Map<string, WsTicker>();
    for (const [k, v] of this.tickers) if (now - v.eventTime <= maxAgeMs) out.set(k, v);
    return out;
  }

  getTicker(symbol: string, maxAgeMs = 15_000): WsTicker | null {
    const t = this.tickers.get(symbol);
    return t && Date.now() - t.eventTime <= maxAgeMs ? t : null;
  }

  getMark(symbol: string, maxAgeMs = 120_000): WsMark | null {
    const m = this.marks.get(symbol);
    return m && Date.now() - m.eventTime <= maxAgeMs ? m : null;
  }

  getStats(): RealtimeStats {
    const toPub = (st: PrivStats): StreamStats => ({
      state: st.state,
      connectedAt: st.connectedAt,
      lastMessageAt: st.lastMessageAt,
      messagesPerMin: st.window.filter((t) => Date.now() - t < 60_000).length,
      reconnectAttempts: st.reconnectAttempts,
      lastError: st.lastError,
    });
    return {
      enabled: this.enabled(),
      spot: toPub(this.spot),
      futures: toPub(this.fut),
      kline: toPub(this.kline),
      klineStreams: this.klineRefs.size,
      tickersTracked: this.tickers.size,
      marksTracked: this.marks.size,
    };
  }
}

function wsErrorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message).slice(0, 200);
  return "websocket error";
}

const globalEngine = globalThis as typeof globalThis & { __orcaBinanceWs?: BinanceRealtimeEngine };
export const binanceWs = globalEngine.__orcaBinanceWs ?? new BinanceRealtimeEngine();
globalEngine.__orcaBinanceWs = binanceWs;

export function ensureBinanceWsStarted() {
  binanceWs.start();
}
