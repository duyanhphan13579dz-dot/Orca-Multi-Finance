import "server-only";
import { recordFailure, recordSuccess } from "../health";
import { eventBus } from "../events";
import { getSsiAccessToken, invalidateSsiToken, ssiFcConfigured } from "../providers/ssi-fcdata";

/**
 * SSI FastConnect DataHub streaming — uses same credentials as REST (SSI_API_KEY / SSI_FC_*).
 *
 * Order book: X / X-QUOTE (BidPrice1–10 / AskPrice1–10).
 * forceEnable(): orderbook API can open WS even when SSI_WS_DISABLED=true (Vercel one-shot).
 * Reconnect: fast first hops, urgent on watchSymbol, session-aware silent/backoff.
 */

const RS = "\x1e";
const DEFAULT_HUB = "https://fc-datahub.ssi.com.vn/v2.0";
const PROVIDER = "ssi-ws";
const MAX_AUTH_FAILS = 5;
const SILENT_MS = 45_000;
const SILENT_MS_SESSION = 25_000; // tighter in HOSE hours
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
  source: "X" | "X-QUOTE" | "X-TRADE";
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
  // Attempt 1–2: near-instant. Later: full-jitter exponential, capped per class.
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
  /** When true, ignore SSI_WS_DISABLED (order-book one-shot on serverless). */
  private forceOn = false;

  /** Temporarily allow WS even if SSI_WS_DISABLED=true (e.g. orderbook API). */
  forceEnable(on = true) {
    this.forceOn = on;
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
    const u1 = this.subscribe(`X:${s}`);
    const u2 = this.subscribe(`B:${s}`);
    // Active subscriber → reconnect ASAP (skip long pending backoff)
    if (this.state !== "open" && this.state !== "connecting") {
      this.reconnectUrgent("watchSymbol");
    }
    return () => {
      u1();
      u2();
    };
  }

  watchIndex(code: string): () => void {
    const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!c) return () => {};
    return this.subscribe(`MI:${c}`);
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
      const url = `${base}/Hubs/DataHub?access_token=${encodeURIComponent(token)}`;
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
        try {
          ws.send(`${JSON.stringify({ protocol: "json", version: 1 })}${RS}`);
        } catch (e) {
          this.failAndReconnect(e instanceof Error ? e.message : "handshake send failed");
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

  /** Cancel long backoff and reconnect within ~50–150ms (new subscriber / force). */
  private reconnectUrgent(_reason: string) {
    if (!this.enabled()) return;
    if (this.state === "open" || this.state === "connecting") return;
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
    recordFailure(PROVIDER, this.lastError);
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
        this.retryScheduled = false;
        this.nextRetryAt = null;
        this.reconnectAttempts = Math.floor(RETRY_BUDGET / 3);
        void this.connect();
      }, cooldown);
      this.timer.unref?.();
      return;
    }

    let delay = computeBackoffMs(kind, this.reconnectAttempts, this.authFailures);

    if (isVnSessionWindow() && (kind === "network" || kind === "silent" || kind === "handshake")) {
      delay = Math.max(40, Math.floor(delay * 0.4));
    }

    // If already scheduled sooner, keep the earlier timer
    if (this.retryScheduled && this.nextRetryAt != null) {
      const remaining = this.nextRetryAt - Date.now();
      if (remaining > 0 && remaining <= delay) {
        this.state = "retrying";
        return;
      }
    }

    this.scheduleReconnect(delay);
  }

  private checkLiveness() {
    if (!this.enabled()) return;
    if (this.state !== "open" || !this.lastMessageAt) return;
    const limit = isVnSessionWindow() ? SILENT_MS_SESSION : SILENT_MS;
    if (Date.now() - this.lastMessageAt > limit) {
      this.lastError = "silent timeout";
      this.hardClose();
      this.failAndReconnect("silent timeout");
    }
  }

  private onRawMessage(raw: string) {
    const parts = raw.split(RS).filter((p) => p.length > 0);
    for (const part of parts) this.handleFrame(part);
  }

  private handleFrame(part: string) {
    this.noteMsg();

    if (part === "{}" || part === "{\n}") {
      this.state = "open";
      this.connectedAt = Date.now();
      this.reconnectAttempts = 0;
      this.authFailures = 0;
      this.lastError = null;
      this.lastFailKind = null;
      this.clearRetryTimer();
      recordSuccess(PROVIDER, 0);
      this.subscribedSent.clear();
      this.sendSubscribe([...this.channelRefs.keys()]);
      return;
    }

    try {
      const msg = JSON.parse(part) as {
        type?: number;
        target?: string;
        arguments?: unknown[];
        error?: string;
      };

      if (msg.error && classifyFail(String(msg.error)) === "auth") {
        this.authFailures += 1;
        invalidateSsiToken();
        this.hardClose();
        this.failAndReconnect(String(msg.error));
        return;
      }

      if (msg.type === 1 && Array.isArray(msg.arguments)) {
        for (const arg of msg.arguments) this.ingestPayload(arg);
        return;
      }

      this.ingestPayload(msg);
    } catch {
      /* control */
    }
  }

  private sendSubscribe(channels: string[]) {
    if (!this.ws || this.state !== "open" || !channels.length) return;
    for (const ch of channels) {
      if (this.subscribedSent.has(ch)) continue;
      try {
        const id = String(++this.invocationId);
        this.ws.send(
          `${JSON.stringify({ type: 1, target: "SwitchChannel", arguments: [ch], invocationId: id })}${RS}`,
        );
        this.subscribedSent.add(ch);
      } catch {
        this.subscribedSent.delete(ch);
      }
    }
  }

  private ingestPayload(arg: unknown) {
    if (arg == null) return;

    if (typeof arg === "object" && arg !== null && "DataType" in arg) {
      const env = arg as { DataType?: string; Content?: unknown };
      const dt = String(env.DataType ?? "").toUpperCase();
      let content: Record<string, unknown> | null = null;
      if (typeof env.Content === "string") {
        try {
          content = JSON.parse(env.Content) as Record<string, unknown>;
        } catch {
          content = null;
        }
      } else if (env.Content && typeof env.Content === "object") {
        content = env.Content as Record<string, unknown>;
      }
      if (content) this.applyContent(dt || String(content.RType ?? content.Rtype ?? ""), content);
      return;
    }

    if (typeof arg === "object" && arg !== null) {
      const o = arg as Record<string, unknown>;
      if ("RType" in o || "Rtype" in o || "Symbol" in o) {
        this.applyContent(String(o.RType ?? o.Rtype ?? ""), o);
      }
    }
  }

  private applyContent(dataType: string, c: Record<string, unknown>) {
    const rtype = (dataType || String(c.RType ?? c.Rtype ?? "")).toUpperCase();
    const now = Date.now();

    if (rtype === "X" || rtype === "X-TRADE" || rtype === "X-QUOTE") {
      const symbol = String(c.Symbol ?? "").toUpperCase();
      if (!symbol) return;
      const price = num(c.LastPrice) ?? num(c.Close) ?? num(c.ClosePrice);

      const bids: SsiOrderBookLevel[] = [];
      const asks: SsiOrderBookLevel[] = [];
      for (let i = 1; i <= 10; i++) {
        const bp = num(c[`BidPrice${i}`]);
        const bv = num(c[`BidVol${i}`]);
        if (bp != null && bp > 0 && bv != null && bv > 0) bids.push({ price: bp, volume: bv });
        const ap = num(c[`AskPrice${i}`]);
        const av = num(c[`AskVol${i}`]);
        if (ap != null && ap > 0 && av != null && av > 0) asks.push({ price: ap, volume: av });
      }

      const hasDepth = bids.length > 0 || asks.length > 0;
      const ceiling = num(c.Ceiling) ?? null;
      const floor = num(c.Floor) ?? null;
      const ref = num(c.RefPrice) ?? null;
      const session = typeof c.TradingSession === "string" ? c.TradingSession : null;

      if (hasDepth) {
        const prevOb = this.orderBooks.get(symbol);
        const ob: SsiOrderBook = {
          symbol,
          bids,
          asks,
          bidTotal: bids.reduce((s, l) => s + l.volume, 0),
          askTotal: asks.reduce((s, l) => s + l.volume, 0),
          lastPrice: price,
          ceiling: ceiling ?? prevOb?.ceiling ?? null,
          floor: floor ?? prevOb?.floor ?? null,
          ref: ref ?? prevOb?.ref ?? null,
          session: session ?? prevOb?.session ?? null,
          eventTime: now,
          source: rtype === "X-TRADE" ? "X-TRADE" : rtype === "X-QUOTE" ? "X-QUOTE" : "X",
        };
        this.orderBooks.set(symbol, ob);
        if (eventBus.subscriberCount(`ssi:orderbook:${symbol}`) > 0) {
          eventBus.emit(`ssi:orderbook:${symbol}`, ob);
        }
      }

      const lastVol = num(c.LastVol);
      if (price != null && price > 0 && lastVol != null && lastVol > 0) {
        const sideRaw = String(c.Side ?? c.side ?? "").toUpperCase();
        let side: "buy" | "sell" | "unknown" = "unknown";
        if (sideRaw === "BU" || sideRaw === "B" || sideRaw === "BUY") side = "buy";
        else if (sideRaw === "SD" || sideRaw === "S" || sideRaw === "SELL") side = "sell";
        const trade: SsiTrade = {
          symbol,
          price,
          volume: lastVol,
          change: num(c.Change),
          changePercent: num(c.RatioChange) ?? num(c.PerChange),
          side,
          time: typeof c.Time === "string" ? c.Time : null,
          eventTime: now,
        };
        const prevTrades = this.trades.get(symbol) ?? [];
        const head = prevTrades[0];
        if (
          !head ||
          head.price !== trade.price ||
          head.volume !== trade.volume ||
          now - head.eventTime > 50
        ) {
          this.trades.set(symbol, [trade, ...prevTrades].slice(0, 80));
          if (eventBus.subscriberCount(`ssi:trade:${symbol}`) > 0) {
            eventBus.emit(`ssi:trade:${symbol}`, trade);
          }
        }
      }

      if (price == null || price <= 0) return;
      const prev = this.quotes.get(symbol);
      const q: SsiLiveQuote = {
        symbol,
        price,
        change: num(c.Change) ?? prev?.change ?? null,
        changePercent: num(c.RatioChange) ?? num(c.PerChange) ?? prev?.changePercent ?? null,
        open: num(c.Open) ?? prev?.open ?? null,
        high: num(c.High) ?? num(c.Highest) ?? prev?.high ?? null,
        low: num(c.Low) ?? num(c.Lowest) ?? prev?.low ?? null,
        volume: num(c.TotalVol) ?? num(c.LastVol) ?? prev?.volume ?? null,
        value: num(c.TotalVal) ?? prev?.value ?? null,
        bid: num(c.BidPrice1) ?? prev?.bid ?? null,
        ask: num(c.AskPrice1) ?? prev?.ask ?? null,
        ceiling: ceiling ?? prev?.ceiling ?? null,
        floor: floor ?? prev?.floor ?? null,
        ref: ref ?? prev?.ref ?? null,
        session: session ?? prev?.session ?? null,
        eventTime: now,
        source: rtype === "X-TRADE" ? "X-TRADE" : "X",
        orderBook: this.orderBooks.get(symbol) ?? prev?.orderBook ?? null,
      };
      this.quotes.set(symbol, q);
      if (eventBus.subscriberCount(`ssi:tick:${symbol}`) > 0) eventBus.emit(`ssi:tick:${symbol}`, q);
      return;
    }

    if (rtype === "B") {
      const symbol = String(c.Symbol ?? "").toUpperCase();
      if (!symbol) return;
      const close = num(c.Close);
      if (close == null || close <= 0) return;
      const prev = this.quotes.get(symbol);
      const q: SsiLiveQuote = {
        symbol,
        price: close,
        change: prev?.change ?? null,
        changePercent: prev?.changePercent ?? null,
        open: num(c.Open) ?? prev?.open ?? null,
        high: num(c.High) ?? prev?.high ?? null,
        low: num(c.Low) ?? prev?.low ?? null,
        volume: num(c.Volume) ?? prev?.volume ?? null,
        value: num(c.Value) ?? prev?.value ?? null,
        bid: prev?.bid ?? null,
        ask: prev?.ask ?? null,
        ceiling: prev?.ceiling ?? null,
        floor: prev?.floor ?? null,
        ref: prev?.ref ?? null,
        session: prev?.session ?? null,
        eventTime: now,
        source: "B",
        orderBook: prev?.orderBook ?? null,
      };
      this.quotes.set(symbol, q);
      if (eventBus.subscriberCount(`ssi:tick:${symbol}`) > 0) eventBus.emit(`ssi:tick:${symbol}`, q);
      return;
    }

    if (rtype === "MI") {
      const code = String(c.IndexID ?? c.IndexCode ?? c.Symbol ?? "").toUpperCase();
      const value = num(c.IndexValue) ?? num(c.IndexValEst);
      if (!code || value == null) return;
      const idx: SsiLiveIndex = {
        code,
        value,
        change: num(c.Change),
        changePercent: num(c.RatioChange),
        advances: num(c.Advances),
        declines: num(c.Declines),
        unchanged: num(c.Nochanges) ?? num(c.Unchanged),
        volume: num(c.TotalQtty) ?? num(c.AllQty),
        valueTraded: num(c.TotalValue) ?? num(c.AllValue),
        eventTime: now,
      };
      this.indices.set(code, idx);
      if (eventBus.subscriberCount(`ssi:index:${code}`) > 0) eventBus.emit(`ssi:index:${code}`, idx);
    }
  }
}

const g = globalThis as typeof globalThis & { __orcaSsiWs?: SsiMarketWsEngine };
export const ssiWs = g.__orcaSsiWs ?? new SsiMarketWsEngine();
g.__orcaSsiWs = ssiWs;

export function ensureSsiWsStarted() {
  ssiWs.start();
  if (ssiFcConfigured() && process.env.SSI_WS_DISABLED !== "true") {
    ssiWs.ensureCoreIndices();
  }
}
