import "server-only";
import { recordFailure, recordSuccess } from "../health";
import { eventBus } from "../events";
import { getSsiAccessToken, invalidateSsiToken, ssiFcConfigured } from "../providers/ssi-fcdata";

/**
 * SSI FastConnect DataHub streaming — uses same credentials as REST (SSI_API_KEY / SSI_FC_*).
 *
 * Order book: DATA/quote.<symbol> (bids/asks arrays). Legacy X/X-QUOTE is
 * still accepted by the parser for deployments that explicitly use it.
 * forceEnable(): orderbook API can open WS even when SSI_WS_DISABLED=true (Vercel one-shot).
 * Reconnect: fast first hops, urgent on watchSymbol, session-aware silent/backoff.
 */

const RS = "\x1e";
const DEFAULT_HUB = "https://fc-datahub.ssi.com.vn/v2.0";
const PROVIDER = "ssi-ws";
const MAX_AUTH_FAILS = 5;
const SILENT_MS = 45_000;
const SILENT_MS_SESSION = 25_000;
const RETRY_BUDGET = 32;

export type SsiWsState = "open" | "connecting" | "closed" | "blocked" | "disabled" | "retrying";

type FailKind = "network" | "handshake" | "rate_limit" | "auth" | "silent" | "unknown";

export interface SsiOrderBookLevel {
  price: number;
  volume: number;
}

export interface SsiOrderBook {
  symbol: string;
  bids: SsiOrderBookLevel[];
  asks: SsiOrderBookLevel[];
  bidTotal: number;
  askTotal: number;
  lastPrice: number | null;
  ceiling: number | null;
  floor: number | null;
  ref: number | null;
  session: string | null;
  eventTime: number;
  source: "X" | "X-QUOTE" | "X-TRADE" | "DATA";
}

export interface SsiTrade {
  symbol: string;
  price: number;
  volume: number;
  change: number | null;
  changePercent: number | null;
  side: "buy" | "sell" | "unknown";
  time: string | null;
  eventTime: number;
}

export interface SsiLiveQuote {
  symbol: string;
  price: number;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  value: number | null;
  bid: number | null;
  ask: number | null;
  ceiling: number | null;
  floor: number | null;
  ref: number | null;
  session: string | null;
  eventTime: number;
  source: "X" | "X-TRADE" | "B";
  orderBook?: SsiOrderBook | null;
}

export interface SsiLiveIndex {
  code: string;
  value: number;
  change: number | null;
  changePercent: number | null;
  advances: number | null;
  declines: number | null;
  unchanged: number | null;
  volume: number | null;
  valueTraded: number | null;
  eventTime: number;
}

export interface SsiWsStats {
  enabled: boolean;
  configured: boolean;
  state: SsiWsState;
  connectedAt: number | null;
  lastMessageAt: number | null;
  messagesPerMin: number;
  reconnectAttempts: number;
  authFailures: number;
  lastError: string | null;
  lastFailKind: FailKind | null;
  nextRetryAt: number | null;
  channels: string[];
  quotesTracked: number;
  orderBooksTracked: number;
  indicesTracked: number;
}

type WsLike = {
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onclose: ((e: { code?: number; reason?: string }) => void) | null;
  close: () => void;
  send: (data: string) => void;
  readyState?: number;
};

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(String(v).replace(/,/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};

function hubBase(): string {
  return (process.env.SSI_FC_HUB_URL ?? DEFAULT_HUB).replace(/\/$/, "");
}

function classifyFail(msg: string): FailKind {
  const m = msg.toLowerCase();
  if (
    m.includes("401") ||
    m.includes("unauthorized") ||
    m.includes("credential") ||
    m.includes("access denied") ||
    (m.includes("token") && (m.includes("invalid") || m.includes("expired") || m.includes("missing")))
  ) {
    return "auth";
  }
  if (m.includes("429") || m.includes("rate") || m.includes("quota") || m.includes("throttl")) {
    return "rate_limit";
  }
  if (m.includes("handshake") || m.includes("protocol")) return "handshake";
  if (m.includes("silent")) return "silent";
  if (
    m.includes("timeout") ||
    m.includes("econn") ||
    m.includes("network") ||
    m.includes("socket") ||
    m.includes("close") ||
    m.includes("reset")
  ) {
    return "network";
  }
  return "unknown";
}

function computeBackoffMs(kind: FailKind, attempt: number, authFailures: number): number {
  const table: Record<FailKind, { base: number; max: number; expCap: number }> = {
    network: { base: 120, max: 8_000, expCap: 7 },
    handshake: { base: 200, max: 8_000, expCap: 6 },
    silent: { base: 300, max: 12_000, expCap: 6 },
    rate_limit: { base: 4_000, max: 90_000, expCap: 4 },
    auth: { base: 8_000, max: 180_000, expCap: 4 },
    unknown: { base: 200, max: 12_000, expCap: 6 },
  };
  const cfg = table[kind];
  const n = Math.min(Math.max(attempt, 1), cfg.expCap);
  if (kind !== "auth" && kind !== "rate_limit" && n <= 2) {
    return n === 1 ? 40 + Math.floor(Math.random() * 80) : 80 + Math.floor(Math.random() * 170);
  }
  const exp = kind === "auth" ? Math.min(Math.max(authFailures, 1), cfg.expCap) : n;
  const ceiling = Math.min(cfg.base * 2 ** (exp - 1), cfg.max);
  const jittered = Math.floor(ceiling * (0.35 + Math.random() * 0.65));
  return Math.max(Math.floor(cfg.base / 2), jittered);
}

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

class SsiMarketWsEngine {
  private started = false;
  private state: SsiWsState = "closed";
  private ws: WsLike | null = null;
  private connectGen = 0;
  private connecting = false;
  private connectedAt: number | null = null;
  private lastMessageAt: number | null = null;
  private reconnectAttempts = 0;
  private authFailures = 0;
  private lastError: string | null = null;
  private lastFailKind: FailKind | null = null;
  private nextRetryAt: number | null = null;
  private retryScheduled = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private secBuckets = new Int16Array(60);
  private secBase = Math.floor(Date.now() / 1000);
  private channelRefs = new Map<string, number>();
  private quotes = new Map<string, SsiLiveQuote>();
  private orderBooks = new Map<string, SsiOrderBook>();
  private trades = new Map<string, SsiTrade[]>();
  private indices = new Map<string, SsiLiveIndex>();
  private invocationId = 0;
  private subscribedSent = new Set<string>();
  private forceOn = false;

  forceEnable(on = true) {
    this.forceOn = on;
    if (on && (this.state === "closed" || this.state === "blocked" || this.state === "disabled")) {
      void this.connect();
    }
  }

  private enabled(): boolean {
    if (!ssiFcConfigured()) return false;
    if (this.forceOn) return true;
    if (process.env.SSI_WS_DISABLED === "true") return false;
    return true;
  }

  subscribe(channel: string): () => void {
    const ch = channel.trim();
    if (!ch) return () => {};
    this.channelRefs.set(ch, (this.channelRefs.get(ch) ?? 0) + 1);
    if (this.state === "open" && !this.subscribedSent.has(ch)) this.sendSubscribe([ch]);
    return () => {
      const n = (this.channelRefs.get(ch) ?? 1) - 1;
      if (n <= 0) {
        this.channelRefs.delete(ch);
        this.subscribedSent.delete(ch);
      } else this.channelRefs.set(ch, n);
    };
  }

  watchSymbol(symbol: string): () => void {
    const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!s) return () => {};
    const u1 = this.subscribe(`quote.${s}`);
    const u2 = this.subscribe(`trade.${s}`);
    const u3 = this.subscribe(`market.${s}`);
    if (this.state !== "open" && this.state !== "connecting") {
      this.reconnectUrgent("watchSymbol");
    }
    return () => {
      u1();
      u2();
      u3();
    };
  }

  watchIndex(code: string): () => void {
    const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!c) return () => {};
    return this.subscribe(`quote.${c}`);
  }

  watchExchange(exchange: string): () => void {
    const board = exchange.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!board) return () => {};
    const unsubs = [
      this.subscribe(`quote.${board}`),
      this.subscribe(`trade.${board}`),
      this.subscribe(`market.${board}`),
    ];
    if (this.state !== "open" && this.state !== "connecting") this.reconnectUrgent("watchExchange");
    return () => unsubs.forEach((unsub) => unsub());
  }

  getOrderBooks(): SsiOrderBook[] {
    return [...this.orderBooks.values()];
  }

  ensureCoreIndices() {
    for (const c of ["VNINDEX", "VN30", "HNX", "HNX30", "UPCOM"]) this.watchIndex(c);
  }

  getQuote(symbol: string, maxAgeMs = 30_000): SsiLiveQuote | null {
    const q = this.quotes.get(symbol.toUpperCase());
    return q && Date.now() - q.eventTime <= maxAgeMs ? q : null;
  }

  getOrderBook(symbol: string, maxAgeMs = 30_000): SsiOrderBook | null {
    const ob = this.orderBooks.get(symbol.toUpperCase());
    return ob && Date.now() - ob.eventTime <= maxAgeMs ? ob : null;
  }

  getTrades(symbol: string, limit = 40): SsiTrade[] {
    const list = this.trades.get(symbol.toUpperCase()) ?? [];
    return list.slice(0, limit);
  }

  waitForOrderBook(symbol: string, maxWaitMs = 400): Promise<SsiOrderBook | null> {
    const sym = symbol.toUpperCase();
    const hit = this.getOrderBook(sym, 20_000);
    if (hit) return Promise.resolve(hit);

    this.watchSymbol(sym);
    if (this.state === "closed" || this.state === "blocked" || this.state === "disabled") void this.connect();

    return new Promise((resolve) => {
      let settled = false;
      const done = (ob: SsiOrderBook | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsub();
        resolve(ob);
      };

      const unsub = eventBus.on(`ssi:orderbook:${sym}`, (payload: unknown) => {
        const ob = payload as SsiOrderBook;
        if (ob && (ob.bids?.length || ob.asks?.length)) done(ob);
      });

      const timer = setTimeout(() => {
        done(this.getOrderBook(sym, 60_000) ?? this.getOrderBook(sym, 72 * 60 * 60_000));
      }, Math.max(50, maxWaitMs));
      timer.unref?.();
    });
  }

  getIndex(code: string, maxAgeMs = 30_000): SsiLiveIndex | null {
    const idx = this.indices.get(code.toUpperCase());
    return idx && Date.now() - idx.eventTime <= maxAgeMs ? idx : null;
  }

  getStats(): SsiWsStats {
    return {
      enabled: this.enabled(),
      configured: ssiFcConfigured(),
      state: this.state,
      connectedAt: this.connectedAt,
      lastMessageAt: this.lastMessageAt,
      messagesPerMin: this.msgsPerMin(),
      reconnectAttempts: this.reconnectAttempts,
      authFailures: this.authFailures,
      lastError: this.lastError,
      lastFailKind: this.lastFailKind,
      nextRetryAt: this.nextRetryAt,
      channels: [...this.channelRefs.keys()],
      quotesTracked: this.quotes.size,
      orderBooksTracked: this.orderBooks.size,
      indicesTracked: this.indices.size,
    };
  }

  start() {
    if (this.started) {
      if (this.state === "closed" || this.state === "blocked" || this.state === "disabled") void this.connect();
      return;
    }
    this.started = true;
    void this.connect();
    this.watchdog = setInterval(() => this.checkLiveness(), 8_000);
    this.watchdog.unref?.();
  }

  private noteMsg(now = Date.now()) {
    this.lastMessageAt = now;
    const sec = Math.floor(now / 1000);
    if (sec !== this.secBase) {
      const drift = Math.min(60, Math.max(0, sec - this.secBase));
      for (let i = 1; i <= drift; i++) this.secBuckets[(this.secBase + i) % 60] = 0;
      this.secBase = sec;
    }
    this.secBuckets[sec % 60] += 1;
  }

  private msgsPerMin(now = Date.now()): number {
    const sec = Math.floor(now / 1000);
    let sum = 0;
    for (let i = 0; i < 60; i++) {
      if (sec - i >= this.secBase - 59) sum += this.secBuckets[(sec - i) % 60] ?? 0;
    }
    return sum;
  }

  private hardClose() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.subscribedSent.clear();
  }

  private clearRetryTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.retryScheduled = false;
    this.nextRetryAt = null;
  }

  private async connect() {
    if (!this.enabled()) {
      this.state = "disabled";
      return;
    }
    if (this.connecting) return;
    if (this.authFailures >= MAX_AUTH_FAILS) {
      this.state = "blocked";
      this.lastError = `auth circuit open after ${this.authFailures} failures — check SSI keys`;
      this.lastFailKind = "auth";
      return;
    }

    const WSImpl = (globalThis as { WebSocket?: new (url: string, protocols?: string | string[]) => WsLike })
      .WebSocket;
    if (!WSImpl) {
      this.state = "disabled";
      this.lastError = "no native WebSocket in runtime";
      return;
    }

    this.connecting = true;
    this.state = "connecting";
    this.clearRetryTimer();
    const gen = ++this.connectGen;
    this.hardClose();

    try {
      const token = await getSsiAccessToken();
      if (gen !== this.connectGen) return;

      const base = hubBase().replace(/^http/, "ws");
      const url = process.env.SSI_WS_PROTOCOL === "signalr"
        ? `${base}/Hubs/DataHub?access_token=${encodeURIComponent(token)}`
        : `${base}?access_token=${encodeURIComponent(token)}`;
      const ws = new WSImpl(url);
      this.ws = ws;

      const handshakeTimer = setTimeout(() => {
        if (gen !== this.connectGen) return;
        if (this.state === "connecting") {
          this.lastError = "handshake timeout";
          try {
            ws.close();
          } catch {
            this.failAndReconnect("handshake timeout");
          }
        }
      }, 4_000);
      handshakeTimer.unref?.();

      ws.onopen = () => {
        if (gen !== this.connectGen) return;
        // SSI's current market-data API uses plain JSON SUBSCRIBE messages.
        // Set SSI_WS_PROTOCOL=signalr only for legacy DataHub tenants.
        if (process.env.SSI_WS_PROTOCOL === "signalr") {
          try {
            ws.send(`${JSON.stringify({ protocol: "json", version: 1 })}${RS}`);
          } catch (e) {
            this.failAndReconnect(e instanceof Error ? e.message : "handshake send failed");
          }
        } else {
          this.onHandshakeOk();
        }
      };

      ws.onmessage = (e) => {
        if (gen !== this.connectGen) return;
        clearTimeout(handshakeTimer);
        const raw = typeof e.data === "string" ? e.data : String(e.data ?? "");
        this.onRawMessage(raw);
      };

      ws.onerror = () => {
        if (gen !== this.connectGen) return;
        this.lastError = "ws error";
      };

      ws.onclose = (ev) => {
        if (gen !== this.connectGen) return;
        clearTimeout(handshakeTimer);
        const reason = `close ${ev.code ?? ""} ${ev.reason ?? ""}`.trim();
        this.failAndReconnect(reason);
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "connect failed";
      if (classifyFail(msg) === "auth") {
        this.authFailures += 1;
        invalidateSsiToken();
      }
      this.failAndReconnect(msg);
    } finally {
      this.connecting = false;
    }
  }

  private reconnectUrgent(_why: string) {
    if (!this.enabled()) return;
    if (this.connecting) return;
    if (this.authFailures >= MAX_AUTH_FAILS) return;

    this.clearRetryTimer();
    this.state = "retrying";
    this.retryScheduled = true;
    const delay = 50 + Math.floor(Math.random() * 100);
    this.nextRetryAt = Date.now() + delay;
    this.timer = setTimeout(() => {
      this.retryScheduled = false;
      this.nextRetryAt = null;
      void this.connect();
    }, delay);
    this.timer.unref?.();
  }

  private scheduleReconnect(delay: number) {
    this.state = "retrying";
    this.retryScheduled = true;
    this.nextRetryAt = Date.now() + delay;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.retryScheduled = false;
      this.nextRetryAt = null;
      void this.connect();
    }, delay);
    this.timer.unref?.();
  }

  private failAndReconnect(reason: string) {
    const kind = classifyFail(reason);
    this.lastFailKind = kind;
    this.lastError = reason.slice(0, 240);
    this.state = kind === "auth" ? "blocked" : "closed";
    recordFailure(PROVIDER, this.lastError ?? "ws failure", "realtime");
    this.subscribedSent.clear();
    this.ws = null;

    if (!this.enabled()) {
      this.clearRetryTimer();
      return;
    }

    if (kind === "auth") {
      this.authFailures += 1;
      invalidateSsiToken();
    }

    if (this.authFailures >= MAX_AUTH_FAILS) {
      this.state = "blocked";
      this.lastError = `auth circuit open — ${this.lastError}`;
      this.clearRetryTimer();
      return;
    }

    this.reconnectAttempts += 1;

    if (this.reconnectAttempts > RETRY_BUDGET && kind !== "auth") {
      const cooldown =
        (isVnSessionWindow() ? 30_000 : 2 * 60_000) + Math.floor(Math.random() * 15_000);
      this.state = "retrying";
      this.retryScheduled = true;
      this.nextRetryAt = Date.now() + cooldown;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.reconnectAttempts = 0;
        this.retryScheduled = false;
        this.nextRetryAt = null;
        void this.connect();
      }, cooldown);
      this.timer.unref?.();
      return;
    }

    const delay = computeBackoffMs(kind, this.reconnectAttempts, this.authFailures);
    this.scheduleReconnect(delay);
  }

  private checkLiveness() {
    if (!this.enabled() || this.state !== "open") return;
    const silentLimit = isVnSessionWindow() ? SILENT_MS_SESSION : SILENT_MS;
    if (this.lastMessageAt && Date.now() - this.lastMessageAt > silentLimit) {
      this.failAndReconnect("silent timeout");
    }
  }

  private onRawMessage(raw: string) {
    this.noteMsg();
    const parts = raw.split(RS).filter(Boolean);
    for (const part of parts) {
      try {
        const msg = JSON.parse(part) as {
          type?: number;
          target?: string;
          arguments?: unknown[];
        };
        if (msg.type === 6) {
          try {
            this.ws?.send(`${JSON.stringify({ type: 6 })}${RS}`);
          } catch {
            /* ignore */
          }
          continue;
        }
        if (msg.type === 7) continue;
        if (msg.type === 1 && msg.target === "Receive") {
          const args = msg.arguments ?? [];
          for (const a of args) this.ingestPayload(a);
          continue;
        }
        if (msg.type === undefined || msg.type === 0) {
          this.onHandshakeOk();
        }
      } catch {
        /* control frames */
      }
    }
  }

  private onHandshakeOk() {
    if (this.state === "connecting" || this.state === "open") {
      this.state = "open";
      this.connectedAt = Date.now();
      this.reconnectAttempts = 0;
      this.authFailures = 0;
      this.lastError = null;
      this.lastFailKind = null;
      recordSuccess(PROVIDER, 0, "realtime");
      this.subscribedSent.clear();
      this.sendSubscribe([...this.channelRefs.keys()]);
    }
  }

  private sendSubscribe(channels: string[]) {
    if (!this.ws || this.state !== "open" || !channels.length) return;
    if (process.env.SSI_WS_PROTOCOL !== "signalr") {
      const topics = channels.filter((topic) => !this.subscribedSent.has(topic));
      if (!topics.length) return;
      try {
        this.ws.send(JSON.stringify({ method: "SUBSCRIBE", channel: "DATA", topics }));
        for (const topic of topics) this.subscribedSent.add(topic);
      } catch {
        /* ignore */
      }
      return;
    }
    for (const ch of channels) {
      if (this.subscribedSent.has(ch)) continue;
      this.invocationId += 1;
      const payload = {
        type: 1,
        target: "SwitchChannel",
        arguments: [[ch]],
        invocationId: String(this.invocationId),
      };
      try {
        this.ws.send(`${JSON.stringify(payload)}${RS}`);
        this.subscribedSent.add(ch);
      } catch {
        /* ignore */
      }
    }
  }

  private ingestPayload(raw: unknown) {
    if (raw == null) return;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch {
        return;
      }
    }
    if (typeof raw !== "object") return;
    const obj = raw as Record<string, unknown>;

    if (Array.isArray(raw)) {
      for (const item of raw) this.ingestPayload(item);
      return;
    }

    const topic = String(obj.Topic ?? obj.topic ?? obj.Channel ?? obj.channel ?? "");
    const content = (obj.Content ?? obj.content ?? obj.Data ?? obj.data ?? obj) as unknown;

    // Current SSI DATA messages carry the symbol directly as `s` and do not
    // wrap the payload in SignalR's Receive/Content envelope.
    if (obj.s != null || obj.bids != null || obj.asks != null) {
      this.ingestQuoteOrBook(topic || "quote", obj);
      return;
    }
    if (obj.p != null && obj.q != null) {
      this.ingestTrade(topic || "trade", obj);
      return;
    }
    if (obj.ce != null || obj.fl != null || obj.ref != null) {
      this.ingestQuoteOrBook(topic || "market", obj);
      return;
    }
    if (content && typeof content === "object" && !Array.isArray(content)) {
      const nested = content as Record<string, unknown>;
      if (nested.s != null || nested.bids != null || nested.asks != null) {
        this.ingestQuoteOrBook(topic || "quote", nested);
        return;
      }
      if (nested.p != null && nested.q != null) {
        this.ingestTrade(topic || "trade", nested);
        return;
      }
    }

    if (topic.startsWith("X:") || topic.startsWith("X-QUOTE") || topic.includes("QUOTE")) {
      this.ingestQuoteOrBook(topic, content);
      return;
    }
    if (topic.startsWith("B:") || topic.includes("TRADE") || topic.startsWith("R:")) {
      this.ingestTrade(topic, content);
      return;
    }
    if (topic.startsWith("MI:") || topic.includes("INDEX")) {
      this.ingestIndex(topic, content);
      return;
    }

    if (obj.Symbol || obj.symbol || obj.StockSymbol) {
      this.ingestQuoteOrBook(topic || "X", content === obj ? obj : content);
    }
  }

  private ingestQuoteOrBook(topic: string, content: unknown) {
    const rows = Array.isArray(content) ? content : [content];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const symbol = String(r.s ?? r.Symbol ?? r.symbol ?? r.StockSymbol ?? r.Code ?? "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
      if (!symbol) continue;

      const lastPrice =
        num(r.LastPrice ?? r.lastPrice ?? r.MatchPrice ?? r.matchPrice ?? r.Price ?? r.price) ??
        num(r.Close ?? r.close);
      const change = num(r.Change ?? r.change ?? r.PriceChange);
      const changePercent = num(r.ChangePercent ?? r.changePercent ?? r.PctChange ?? r.PerChange);
      const open = num(r.Open ?? r.open ?? r.OpenPrice);
      const high = num(r.High ?? r.high ?? r.Highest);
      const low = num(r.Low ?? r.low ?? r.Lowest);
      const volume = num(r.TotalVol ?? r.TotalVolume ?? r.volume ?? r.Volume ?? r.MatchQtty);
      const value = num(r.TotalValue ?? r.value ?? r.Value ?? r.MatchValue);
      const bid = num(r.BidPrice1 ?? r.BestBid ?? r.bid);
      const ask = num(r.AskPrice1 ?? r.BestAsk ?? r.ask);
      const ceiling = num(r.Ceiling ?? r.ceiling ?? r.Ceil);
      const floor = num(r.Floor ?? r.floor);
      const ref = num(r.RefPrice ?? r.ref ?? r.BasicPrice ?? r.PriorClosePrice);
      const session =
        r.Session != null ? String(r.Session) : r.TradingSession != null ? String(r.TradingSession) : null;

      const bids: SsiOrderBookLevel[] = [];
      const asks: SsiOrderBookLevel[] = [];
      if (Array.isArray(r.bids)) {
        for (const level of r.bids) {
          if (!Array.isArray(level)) continue;
          const price = num(level[0]);
          const volume = num(level[1]);
          if (price != null && price > 0) bids.push({ price, volume: volume ?? 0 });
        }
      }
      if (Array.isArray(r.asks)) {
        for (const level of r.asks) {
          if (!Array.isArray(level)) continue;
          const price = num(level[0]);
          const volume = num(level[1]);
          if (price != null && price > 0) asks.push({ price, volume: volume ?? 0 });
        }
      }
      for (let i = 1; i <= 10; i++) {
        const bp = num(r[`BidPrice${i}`] ?? r[`bidPrice${i}`]);
        const bv = num(r[`BidVol${i}`] ?? r[`BidVolume${i}`] ?? r[`bidVol${i}`]);
        if (bp != null && bp > 0) bids.push({ price: bp, volume: bv ?? 0 });
        const ap = num(r[`AskPrice${i}`] ?? r[`askPrice${i}`]);
        const av = num(r[`AskVol${i}`] ?? r[`AskVolume${i}`] ?? r[`askVol${i}`]);
        if (ap != null && ap > 0) asks.push({ price: ap, volume: av ?? 0 });
      }

      const now = Date.now();
      if (bids.length || asks.length) {
        const bidTotal = bids.reduce((s, x) => s + (x.volume || 0), 0);
        const askTotal = asks.reduce((s, x) => s + (x.volume || 0), 0);
        const book: SsiOrderBook = {
          symbol,
          bids,
          asks,
          bidTotal,
          askTotal,
          lastPrice: lastPrice ?? null,
          ceiling,
          floor,
          ref,
          session,
          eventTime: now,
          source: topic.startsWith("quote") || topic === "market" ? "DATA" : topic.includes("QUOTE") ? "X-QUOTE" : "X",
        };
        this.orderBooks.set(symbol, book);
        eventBus.emit(`ssi:orderbook:${symbol}`, book);
      }

      if (lastPrice != null || open != null || volume != null) {
        const prev = this.quotes.get(symbol);
        const q: SsiLiveQuote = {
          symbol,
          price: lastPrice ?? prev?.price ?? 0,
          change: change ?? prev?.change ?? null,
          changePercent: changePercent ?? prev?.changePercent ?? null,
          open: open ?? prev?.open ?? null,
          high: high ?? prev?.high ?? null,
          low: low ?? prev?.low ?? null,
          volume: volume ?? prev?.volume ?? null,
          value: value ?? prev?.value ?? null,
          bid: bid ?? prev?.bid ?? null,
          ask: ask ?? prev?.ask ?? null,
          ceiling: ceiling ?? prev?.ceiling ?? null,
          floor: floor ?? prev?.floor ?? null,
          ref: ref ?? prev?.ref ?? null,
          session: session ?? prev?.session ?? null,
          eventTime: now,
          source: topic.startsWith("B") ? "B" : "X",
          orderBook: this.orderBooks.get(symbol) ?? prev?.orderBook ?? null,
        };
        this.quotes.set(symbol, q);
        eventBus.emit(`ssi:quote:${symbol}`, q);
      }
    }
  }

  private ingestTrade(topic: string, content: unknown) {
    const rows = Array.isArray(content) ? content : [content];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const symbol = String(r.s ?? r.Symbol ?? r.symbol ?? r.StockSymbol ?? "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
      if (!symbol) continue;
      const price = num(r.p ?? r.Price ?? r.price ?? r.MatchPrice ?? r.LastPrice);
      const volume = num(r.q ?? r.Volume ?? r.volume ?? r.MatchQtty ?? r.Qtty) ?? 0;
      if (price == null) continue;
      const change = num(r.Change ?? r.change);
      const changePercent = num(r.ChangePercent ?? r.changePercent);
      const sideRaw = String(r.si ?? r.Side ?? r.side ?? r.BuySell ?? "").toLowerCase();
      const side: SsiTrade["side"] =
        sideRaw === "b" || sideRaw === "buy" || sideRaw === "bid"
          ? "buy"
          : sideRaw === "s" || sideRaw === "sell" || sideRaw === "ask"
            ? "sell"
            : "unknown";
      const time = r.Time != null ? String(r.Time) : r.TradingTime != null ? String(r.TradingTime) : null;
      const trade: SsiTrade = {
        symbol,
        price,
        volume,
        change,
        changePercent,
        side,
        time,
        eventTime: Date.now(),
      };
      const list = this.trades.get(symbol) ?? [];
      list.unshift(trade);
      if (list.length > 80) list.length = 80;
      this.trades.set(symbol, list);
      eventBus.emit(`ssi:trade:${symbol}`, trade);

      const prev = this.quotes.get(symbol);
      if (prev) {
        this.quotes.set(symbol, {
          ...prev,
          price,
          change: change ?? prev.change,
          changePercent: changePercent ?? prev.changePercent,
          eventTime: Date.now(),
          source: "X-TRADE",
        });
      }
    }
  }

  private ingestIndex(topic: string, content: unknown) {
    const rows = Array.isArray(content) ? content : [content];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const code = String(r.IndexCode ?? r.Code ?? r.code ?? r.Symbol ?? topic.replace(/^MI:/, ""))
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
      if (!code) continue;
      const value = num(r.IndexValue ?? r.Value ?? r.value ?? r.Last ?? r.Close);
      if (value == null) continue;
      const idx: SsiLiveIndex = {
        code,
        value,
        change: num(r.Change ?? r.change),
        changePercent: num(r.ChangePercent ?? r.changePercent ?? r.PctChange),
        advances: num(r.Advances ?? r.advances ?? r.Up),
        declines: num(r.Declines ?? r.declines ?? r.Down),
        unchanged: num(r.NoChange ?? r.unchanged ?? r.Unchanged),
        volume: num(r.TotalVolume ?? r.volume ?? r.Volume),
        valueTraded: num(r.TotalValue ?? r.valueTraded ?? r.Value),
        eventTime: Date.now(),
      };
      this.indices.set(code, idx);
      eventBus.emit(`ssi:index:${code}`, idx);
    }
  }
}

function getWsEngine(): SsiMarketWsEngine {
  const g = globalThis as unknown as { __orcaSsiWs?: SsiMarketWsEngine };
  if (!g.__orcaSsiWs) g.__orcaSsiWs = new SsiMarketWsEngine();
  return g.__orcaSsiWs;
}

export const ssiWs = getWsEngine();

export function ensureSsiWsStarted() {
  ssiWs.start();
  if (ssiFcConfigured() && process.env.SSI_WS_DISABLED !== "true") {
    ssiWs.ensureCoreIndices();
  }
}
