import "server-only";
import { recordFailure, recordSuccess } from "../health";
import { eventBus } from "../events";
import { env } from "../env";

/**
 * CENTRALIZED BINANCE WEBSOCKET INGESTION ENGINE (perf-tuned)
 *
 * One shared connection for the whole platform (never per-user):
 *   wss://stream.binance.com  !ticker@arr      → spot realtime store
 *   wss://fstream.binance.com !markPrice@arr   → futures marks/funding store
 *   wss://stream.binance.com  /ws              → dynamic kline SUBSCRIBE
 *
 * Hot-path optimisations:
 *   - tick emit only when channel has listeners (avoids 2k+ no-op emits/msg)
 *   - kline uses incremental SUBSCRIBE/UNSUBSCRIBE (no full reconnect churn)
 *   - stats use ring counters instead of unbounded timestamp arrays
 *   - stale ticker/mark pruning on watchdog
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
  ticksEmittedPerMin: number;
  ticksSkippedPerMin: number;
}

export const KLINE_INTERVALS = new Set([
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "6h",
  "8h",
  "12h",
  "1d",
  "3d",
  "1w",
  "1M",
]);

export interface KlineCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: boolean;
}

const SPOT_URL = env.binanceWsSpotUrl;
const FUT_URL = env.binanceWsFutUrl;
const KLINE_WS_URL = env.binanceWsKlineUrl;
const SPOT_PROVIDER = "binance-ws:spot";
const FUT_PROVIDER = "binance-ws:futures";
const KLINE_PROVIDER = "binance-ws:kline";
const MAX_KLINE_STREAMS = env.binanceWsMaxKlines;

interface PrivStats {
  state: StreamStats["state"];
  connectedAt: number | null;
  lastMessageAt: number | null;
  secBuckets: Int16Array;
  secBase: number;
  reconnectAttempts: number;
  lastError: string | null;
}

const newStats = (): PrivStats => ({
  state: "connecting",
  connectedAt: null,
  lastMessageAt: null,
  secBuckets: new Int16Array(60),
  secBase: Math.floor(Date.now() / 1000),
  reconnectAttempts: 0,
  lastError: null,
});

function noteMsg(st: PrivStats, now = Date.now()) {
  st.lastMessageAt = now;
  const sec = Math.floor(now / 1000);
  if (sec !== st.secBase) {
    const drift = sec - st.secBase;
    if (drift >= 60) {
      st.secBuckets.fill(0);
    } else {
      for (let i = 1; i <= drift; i++) st.secBuckets[(st.secBase + i) % 60] = 0;
    }
    st.secBase = sec;
  }
  st.secBuckets[sec % 60]++;
}

function msgsPerMin(st: PrivStats, now = Date.now()): number {
  const sec = Math.floor(now / 1000);
  if (sec - st.secBase >= 60) return 0;
  let sum = 0;
  for (let i = 0; i < 60; i++) sum += st.secBuckets[i];
  return sum;
}

type WsLike = {
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onclose: ((e: { code?: number; reason?: string }) => void) | null;
  close: () => void;
  send?: (data: string) => void;
  readyState?: number;
};

class BinanceRealtimeEngine {
  private started = false;
  private tickers = new Map<string, WsTicker>();
  private marks = new Map<string, WsMark>();
  private spot: PrivStats = newStats();
  private fut: PrivStats = newStats();
  private kline: PrivStats = newStats();
  private klineRefs = new Map<string, number>();
  private klineDesired = new Set<string>();
  private klineWs: WsLike | null = null;
  private klineSubTimer: ReturnType<typeof setTimeout> | null = null;
  private klineMsgId = 1;
  private spotWs: WsLike | null = null;
  private futWs: WsLike | null = null;
  private spotTimer: ReturnType<typeof setTimeout> | null = null;
  private futTimer: ReturnType<typeof setTimeout> | null = null;
  private klineTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private emitOk = 0;
  private emitSkip = 0;
  private emitWindowStart = Date.now();

  private enabled(): boolean {
    return !env.binanceWsDisabled;
  }

  requestKline(symbol: string, interval: string): () => void {
    if (!this.enabled() || !KLINE_INTERVALS.has(interval)) return () => {};
    this.start();
    const sym = symbol.toUpperCase();
    const key = `${sym}@${interval}`;
    this.klineRefs.set(key, (this.klineRefs.get(key) ?? 0) + 1);
    this.scheduleKlineSync();
    return () => {
      const n = (this.klineRefs.get(key) ?? 0) - 1;
      if (n <= 0) this.klineRefs.delete(key);
      else this.klineRefs.set(key, n);
      this.scheduleKlineSync();
    };
  }

  klineKeys(): string[] {
    return [...this.klineRefs.keys()];
  }

  private scheduleKlineSync() {
    if (this.klineSubTimer) clearTimeout(this.klineSubTimer);
    this.klineSubTimer = setTimeout(() => this.syncKlineSubscriptions(), 200);
    this.klineSubTimer.unref?.();
  }

  private desiredStreams(): string[] {
    const keys = [...this.klineRefs.keys()];
    const rank = (k: string) => {
      const tf = k.split("@")[1] ?? "";
      if (tf === "1m") return 0;
      if (tf === "5m") return 1;
      if (tf === "15m") return 2;
      return 3;
    };
    keys.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    return keys.slice(0, MAX_KLINE_STREAMS).map((k) => {
      const [sym, tf] = k.split("@");
      return `${sym.toLowerCase()}@kline_${tf}`;
    });
  }

  private syncKlineSubscriptions() {
    const desired = new Set(this.desiredStreams());
    if (!desired.size) {
      this.klineDesired.clear();
      try {
        this.klineWs?.close();
      } catch {
        /* noop */
      }
      this.klineWs = null;
      this.kline.state = "closed";
      return;
    }

    const WSImpl = (globalThis as { WebSocket?: new (url: string) => WsLike }).WebSocket;
    if (!WSImpl) {
      this.kline.state = "disabled";
      return;
    }

    if (!this.klineWs || this.kline.state === "closed" || this.kline.state === "blocked") {
      this.openKlineSocket(WSImpl, desired);
      return;
    }

    if (this.kline.state !== "open" || typeof this.klineWs.send !== "function") {
      this.openKlineSocket(WSImpl, desired);
      return;
    }

    const toSub: string[] = [];
    const toUnsub: string[] = [];
    for (const s of desired) if (!this.klineDesired.has(s)) toSub.push(s);
    for (const s of this.klineDesired) if (!desired.has(s)) toUnsub.push(s);

    if (toUnsub.length) {
      try {
        this.klineWs.send(JSON.stringify({ method: "UNSUBSCRIBE", params: toUnsub, id: this.klineMsgId++ }));
      } catch {
        this.openKlineSocket(WSImpl, desired);
        return;
      }
    }
    if (toSub.length) {
      try {
        this.klineWs.send(JSON.stringify({ method: "SUBSCRIBE", params: toSub, id: this.klineMsgId++ }));
      } catch {
        this.openKlineSocket(WSImpl, desired);
        return;
      }
    }
    this.klineDesired = desired;
  }

  private openKlineSocket(WSImpl: new (url: string) => WsLike, desired: Set<string>) {
    try {
      this.klineWs?.close();
    } catch {
      /* noop */
    }
    this.klineWs = null;
    this.klineDesired = new Set();
    try {
      this.kline.state = "connecting";
      const ws = new WSImpl(KLINE_WS_URL);
      this.klineWs = ws;
      ws.onopen = () => {
        this.kline.state = "open";
        this.kline.connectedAt = Date.now();
        this.kline.lastError = null;
        this.kline.reconnectAttempts = 0;
        recordSuccess(KLINE_PROVIDER, 0);
        const params = [...desired];
        if (params.length && typeof ws.send === "function") {
          try {
            ws.send(JSON.stringify({ method: "SUBSCRIBE", params, id: this.klineMsgId++ }));
            this.klineDesired = new Set(params);
          } catch {
            /* next sync */
          }
        }
      };
      ws.onmessage = (e) => this.onKlineMessage(e);
      ws.onerror = (e) => {
        this.kline.lastError = wsErrorMessage(e);
      };
      ws.onclose = (e) => {
        this.kline.state = this.kline.lastError ? "blocked" : "closed";
        this.klineDesired.clear();
        recordFailure(KLINE_PROVIDER, this.kline.lastError ?? `close ${e.code ?? ""}`);
        if (this.klineRefs.size) {
          this.kline.reconnectAttempts += 1;
          const delay = Math.min(1500 * 2 ** Math.min(this.kline.reconnectAttempts, 5), 30_000) + Math.random() * 800;
          this.kline.state = "retrying";
          if (this.klineTimer) clearTimeout(this.klineTimer);
          this.klineTimer = setTimeout(() => {
            if (this.klineRefs.size) this.syncKlineSubscriptions();
          }, delay);
          this.klineTimer.unref?.();
        }
      };
    } catch (err) {
      this.kline.lastError = err instanceof Error ? err.message : "kline connect failed";
      this.kline.state = "blocked";
      recordFailure(KLINE_PROVIDER, this.kline.lastError);
    }
  }

  private onKlineMessage(e: { data: unknown }) {
    noteMsg(this.kline);
    try {
      const raw = String(e.data);
      if (raw.length < 80 && raw.includes('"result"')) return;
      const msg = JSON.parse(raw) as { stream?: string; data?: Record<string, unknown>; k?: Record<string, unknown> };
      const k = (msg.data?.k ?? msg.k) as Record<string, unknown> | undefined;
      if (!k || typeof k.s !== "string" || typeof k.i !== "string") return;
      const sym = k.s;
      const tf = k.i;
      const time = Number(k.t);
      const open = Number(k.o);
      const high = Number(k.h);
      const low = Number(k.l);
      const close = Number(k.c);
      if (!Number.isFinite(time) || open <= 0 || high < low || close <= 0) return;
      const candle: KlineCandle = {
        time,
        open,
        high,
        low,
        close,
        volume: Number(k.v) || 0,
        closed: Boolean(k.x),
      };
      eventBus.emit(`kline:${sym}:${tf}`, { symbol: sym, timeframe: tf, candle });
    } catch {
      /* malformed */
    }
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
        noteMsg(st);
        try {
          const parsed = JSON.parse(String(e.data)) as { stream?: string; data?: unknown };
          if (kind === "spot") this.ingestTickers(parsed.data);
          else this.ingestMarks(parsed.data);
        } catch {
          /* drop */
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
          this.scheduleReconnect(kind, kind === "spot" ? SPOT_URL : FUT_URL);
        }
      }
    }
    if (this.kline.state === "open" && this.kline.lastMessageAt && now - this.kline.lastMessageAt > 90_000 && this.klineRefs.size) {
      this.kline.lastError = "kline silent > 90s — reconnect";
      try {
        this.klineWs?.close();
      } catch {
        this.syncKlineSubscriptions();
      }
    }
    for (const [k, v] of this.tickers) {
      if (now - v.eventTime > 120_000) this.tickers.delete(k);
    }
    for (const [k, v] of this.marks) {
      if (now - v.eventTime > 300_000) this.marks.delete(k);
    }
  }

  private ingestTickers(data: unknown) {
    if (!Array.isArray(data)) return;
    const now = Date.now();
    if (now - this.emitWindowStart > 60_000) {
      this.emitOk = 0;
      this.emitSkip = 0;
      this.emitWindowStart = now;
    }
    for (const raw of data) {
      const r = raw as Record<string, unknown>;
      const symbol = typeof r.s === "string" ? r.s : null;
      const price = Number(r.c);
      const eventTime = Number(r.E);
      if (!symbol || !Number.isFinite(price) || price <= 0 || !Number.isFinite(eventTime)) continue;
      if (eventTime > now + 60_000 || eventTime < now - 600_000) continue;

      const changePercent = Number(r.P);
      const volume = Number(r.v) || 0;
      const quoteVolume = Number(r.q) || 0;

      this.tickers.set(symbol, {
        symbol,
        price,
        changePercent: Number.isFinite(changePercent) ? changePercent : 0,
        volume,
        quoteVolume,
        eventTime,
      });

      if (eventBus.subscriberCount(`tick:${symbol}`) > 0) {
        this.emitOk++;
        eventBus.emit(`tick:${symbol}`, {
          symbol,
          price,
          cumVolume: volume,
          cumQuoteVolume: quoteVolume,
          ts: eventTime,
        });
      } else {
        this.emitSkip++;
      }
    }
  }

  private ingestMarks(data: unknown) {
    if (!Array.isArray(data)) return;
    const now = Date.now();
    for (const raw of data) {
      const r = raw as Record<string, unknown>;
      const symbol = typeof r.s === "string" ? r.s : null;
      const markPrice = Number(r.p);
      const eventTime = Number(r.E);
      if (!symbol || !Number.isFinite(markPrice) || markPrice <= 0 || !Number.isFinite(eventTime)) continue;
      if (eventTime > now + 60_000 || eventTime < now - 600_000) continue;
      this.marks.set(symbol, {
        symbol,
        markPrice,
        fundingRate: Number.isFinite(Number(r.r)) ? Number(r.r) : 0,
        eventTime,
      });
    }
  }

  getTickers(maxAgeMs = 15_000): Map<string, WsTicker> {
    const now = Date.now();
    const out = new Map<string, WsTicker>();
    for (const [k, v] of this.tickers) if (now - v.eventTime <= maxAgeMs) out.set(k, v);
    return out;
  }

  getTicker(symbol: string, maxAgeMs = 15_000): WsTicker | null {
    const t = this.tickers.get(symbol.toUpperCase());
    return t && Date.now() - t.eventTime <= maxAgeMs ? t : null;
  }

  getMark(symbol: string, maxAgeMs = 120_000): WsMark | null {
    const m = this.marks.get(symbol.toUpperCase());
    return m && Date.now() - m.eventTime <= maxAgeMs ? m : null;
  }

  getStats(): RealtimeStats {
    const toPub = (st: PrivStats): StreamStats => ({
      state: st.state,
      connectedAt: st.connectedAt,
      lastMessageAt: st.lastMessageAt,
      messagesPerMin: msgsPerMin(st),
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
      ticksEmittedPerMin: this.emitOk,
      ticksSkippedPerMin: this.emitSkip,
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
