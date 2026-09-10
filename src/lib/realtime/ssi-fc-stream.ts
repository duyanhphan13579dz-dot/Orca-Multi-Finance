import "server-only";
import { recordFailure, recordSuccess } from "../health";
import { eventBus } from "../events";
import {
  getFcAccessTokenBundle,
  invalidateFcToken,
  ssiFastConfigured,
  type FcIndexSummary,
  getFcIndexSummary,
} from "../providers/ssi-fastconnect";

/**
 * SSI FastConnect v3 WebSocket engine (developers.ssi.com.vn).
 *
 * Endpoint : wss://stream.ssi.com.vn/ws/v3   (env SSI_STREAMING_URL)
 * Auth     : Bearer token from /api/v3/auth/token (query-param fallback for
 *            runtimes that cannot set WS headers).
 * Protocol : JSON messages {method, channel, topics}
 *            SUBSCRIBE/UNSUBSCRIBE on channels DATA | TRADING
 *            HEARTBEAT ping/pong keeps the session alive.
 * Topics   : trade.<sym>[@1m|5m] · quote.<sym> · room.<sym> · put.<sym> ·
 *            oddlot.<sym> · market.<board> · order.<accountNo> ·
 *            portfolio.<accountNo>
 *
 * Reconnect uses full-jitter exponential backoff with an auth circuit
 * breaker; after every reconnect all topics are re-subscribed.
 */

const PROVIDER = "ssi-fc-stream";
const DEFAULT_STREAM_URL = "wss://stream.ssi.com.vn/ws/v3";
const MAX_AUTH_FAILS = 5;
const SILENT_MS = 90_000;
const RETRY_BUDGET = 24;
const PING_INTERVAL_MS = 30_000;

export type SsiFcStreamState = "open" | "connecting" | "closed" | "blocked" | "disabled" | "retrying";

type FailKind = "network" | "handshake" | "rate_limit" | "auth" | "silent" | "unknown";

/** Same shape as the legacy DataHub quote — services consume both uniformly. */
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
  source: "ssi-fc-stream";
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

export interface SsiFcStreamStats {
  enabled: boolean;
  configured: boolean;
  state: SsiFcStreamState;
  connectedAt: number | null;
  lastMessageAt: number | null;
  messagesPerMin: number;
  reconnectAttempts: number;
  authFailures: number;
  lastError: string | null;
  lastFailKind: FailKind | null;
  nextRetryAt: number | null;
  topics: string[];
  quotesTracked: number;
  indicesTracked: number;
}

/* ------------------------------- pure state ------------------------------- */

export interface FcStreamData {
  quotes: Map<string, SsiLiveQuote>;
  indices: Map<string, SsiLiveIndex>;
  marketInfo: Map<string, { ceiling: number | null; floor: number | null; ref: number | null; board: string | null }>;
  marketFlags: Map<string, { flag: string; at: number }>;
  indexRefs: Map<string, { prevClose: number; name: string | null }>;
}

export function createFcStreamData(): FcStreamData {
  return {
    quotes: new Map(),
    indices: new Map(),
    marketInfo: new Map(),
    marketFlags: new Map(),
    indexRefs: new Map(),
  };
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(String(v).replace(/,/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};

function computeChange(state: FcStreamData, symbol: string, price: number): { change: number | null; changePercent: number | null } {
  const ref = state.marketInfo.get(symbol)?.ref ?? null;
  if (ref != null && ref > 0) {
    const change = price - ref;
    return { change, changePercent: (change / ref) * 100 };
  }
  return { change: null, changePercent: null };
}

/**
 * Ingest one parsed server message into the state maps. Exported for unit
 * tests — the engine wraps this.
 */
export function fcStreamIngest(
  state: FcStreamData,
  msg: { channel?: unknown; topic?: unknown; data?: unknown },
  now = Date.now(),
): { kind: string; symbol?: string } | null {
  const channel = String(msg.channel ?? "").toUpperCase();
  const topic = String(msg.topic ?? "");
  const d = (msg.data ?? null) as Record<string, unknown> | null;
  if (!d || typeof d !== "object") return null;

  if (channel === "TRADING") {
    const eventType = String((d as { eventType?: unknown }).eventType ?? "");
    if (topic.startsWith("order.") || eventType) {
      const accountNo = String((d as { accountNo?: unknown }).accountNo ?? "");
      if (eventBus.subscriberCount(`ssi:order:${accountNo}`) > 0) eventBus.emit(`ssi:order:${accountNo}`, d);
      if (eventBus.subscriberCount("ssi:order:*") > 0) eventBus.emit("ssi:order:*", d);
      return { kind: eventType || "order" };
    }
    if (topic.startsWith("portfolio.")) {
      if (eventBus.subscriberCount("ssi:portfolio") > 0) eventBus.emit("ssi:portfolio", d);
      return { kind: "portfolio" };
    }
    return { kind: "trading-other" };
  }

  if (channel !== "DATA") return null;
  const prefix = topic.split(".", 1)[0] ?? "";
  const symbol = String((d as { s?: unknown }).s ?? "").toUpperCase();

  switch (prefix) {
    case "trade": {
      if (!symbol) return null;
      // index symbols stream on trade topics too
      const idxRef = state.indexRefs.get(symbol);
      const isInterval = topic.includes("@") && !topic.endsWith("@tick");
      if (isInterval) {
        // IntervalMessage (o/h/l/c/v) — treat close as last price
        const c = num((d as { c?: unknown }).c);
        if (c == null || c <= 0) return { kind: "interval", symbol };
        applyPrice(state, symbol, c, d, now, idxRef != null);
        return { kind: "interval", symbol };
      }
      const p = num((d as { p?: unknown }).p);
      if (p == null || p <= 0) return { kind: "trade", symbol };
      applyPrice(state, symbol, p, d, now, idxRef != null);
      return { kind: "trade", symbol };
    }
    case "quote": {
      if (!symbol) return null;
      const prev = state.quotes.get(symbol);
      const bids = Array.isArray((d as { bids?: unknown }).bids) ? ((d as { bids?: unknown[] }).bids as unknown[]) : [];
      const asks = Array.isArray((d as { asks?: unknown }).asks) ? ((d as { asks?: unknown[] }).asks as unknown[]) : [];
      const bestBid = num(Array.isArray(bids[0]) ? (bids[0] as unknown[])[0] : null);
      const bestAsk = num(Array.isArray(asks[0]) ? (asks[0] as unknown[])[0] : null);
      if (prev) {
        if (bestBid != null) prev.bid = bestBid;
        if (bestAsk != null) prev.ask = bestAsk;
        prev.eventTime = now;
      } else if (bestBid != null || bestAsk != null) {
        const price = bestBid ?? bestAsk ?? 0;
        if (price > 0) {
          const { change, changePercent } = computeChange(state, symbol, price);
          state.quotes.set(symbol, {
            symbol,
            price,
            change,
            changePercent,
            open: null,
            high: null,
            low: null,
            volume: null,
            value: null,
            bid: bestBid,
            ask: bestAsk,
            ceiling: state.marketInfo.get(symbol)?.ceiling ?? null,
            floor: state.marketInfo.get(symbol)?.floor ?? null,
            ref: state.marketInfo.get(symbol)?.ref ?? null,
            session: null,
            eventTime: now,
            source: "ssi-fc-stream",
          });
        }
      }
      return { kind: "quote", symbol };
    }
    case "market": {
      if (symbol) {
        state.marketInfo.set(symbol, {
          ceiling: num((d as { ce?: unknown }).ce),
          floor: num((d as { fl?: unknown }).fl),
          ref: num((d as { ref?: unknown }).ref),
          board: typeof (d as { b?: unknown }).b === "string" ? String((d as { b?: unknown }).b).toUpperCase() : null,
        });
        const q = state.quotes.get(symbol);
        if (q) {
          q.ceiling = state.marketInfo.get(symbol)!.ceiling;
          q.floor = state.marketInfo.get(symbol)!.floor;
          q.ref = state.marketInfo.get(symbol)!.ref;
          const cc = computeChange(state, symbol, q.price);
          q.change = cc.change;
          q.changePercent = cc.changePercent;
        }
        return { kind: "market", symbol };
      }
      // session flag: {b, t, f}
      const board = String((d as { b?: unknown }).b ?? "").toUpperCase();
      const flag = String((d as { f?: unknown }).f ?? "");
      if (board && flag) state.marketFlags.set(board, { flag, at: now });
      return { kind: "flag", symbol: board };
    }
    case "room": {
      if (!symbol) return null;
      if (eventBus.subscriberCount(`ssi:room:${symbol}`) > 0) eventBus.emit(`ssi:room:${symbol}`, d);
      return { kind: "room", symbol };
    }
    case "put": {
      if (!symbol) return null;
      if (eventBus.subscriberCount(`ssi:put:${symbol}`) > 0) eventBus.emit(`ssi:put:${symbol}`, d);
      return { kind: "put", symbol };
    }
    case "oddlot": {
      if (!symbol) return null;
      if (eventBus.subscriberCount(`ssi:oddlot:${symbol}`) > 0) eventBus.emit(`ssi:oddlot:${symbol}`, d);
      return { kind: "oddlot", symbol };
    }
    default:
      return null;
  }
}

function applyPrice(
  state: FcStreamData,
  symbol: string,
  price: number,
  d: Record<string, unknown>,
  now: number,
  isIndex: boolean,
) {
  if (isIndex) {
    const ref = state.indexRefs.get(symbol);
    const prevClose = ref?.prevClose ?? null;
    const change = prevClose != null ? price - prevClose : null;
    const idx: SsiLiveIndex = {
      code: symbol,
      value: price,
      change,
      changePercent: change != null && prevClose ? (change / prevClose) * 100 : null,
      advances: null,
      declines: null,
      unchanged: null,
      volume: num(d.v ?? d.TotalQtty),
      valueTraded: null,
      eventTime: now,
    };
    state.indices.set(symbol, idx);
    if (eventBus.subscriberCount(`ssi:index:${symbol}`) > 0) eventBus.emit(`ssi:index:${symbol}`, idx);
    return;
  }

  const prev = state.quotes.get(symbol);
  const { change, changePercent } = computeChange(state, symbol, price);
  const mi = state.marketInfo.get(symbol);
  const q: SsiLiveQuote = {
    symbol,
    price,
    change: change ?? prev?.change ?? null,
    changePercent: changePercent ?? prev?.changePercent ?? null,
    open: num(d.o) ?? prev?.open ?? null,
    high: num(d.h) ?? prev?.high ?? null,
    low: num(d.l) ?? prev?.low ?? null,
    volume: num(d.v) ?? prev?.volume ?? null,
    value: prev?.value ?? null,
    bid: prev?.bid ?? null,
    ask: prev?.ask ?? null,
    ceiling: mi?.ceiling ?? prev?.ceiling ?? null,
    floor: mi?.floor ?? prev?.floor ?? null,
    ref: mi?.ref ?? prev?.ref ?? null,
    session: prev?.session ?? null,
    eventTime: now,
    source: "ssi-fc-stream",
  };
  state.quotes.set(symbol, q);
  if (eventBus.subscriberCount(`ssi:tick:${symbol}`) > 0) eventBus.emit(`ssi:tick:${symbol}`, q);
}

/* --------------------------------- engine --------------------------------- */

type WsLike = {
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onclose: ((e: { code?: number; reason?: string }) => void) | null;
  close: () => void;
  send: (data: string) => void;
  readyState?: number;
};

function classifyFail(msg: string): FailKind {
  const m = msg.toLowerCase();
  if (
    m.includes("401") ||
    m.includes("403") ||
    m.includes("unauthorized") ||
    m.includes("credential") ||
    m.includes("access denied") ||
    (m.includes("token") && (m.includes("invalid") || m.includes("expired") || m.includes("missing")))
  ) {
    return "auth";
  }
  if (m.includes("429") || m.includes("rate") || m.includes("quota") || m.includes("throttl")) return "rate_limit";
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
    network: { base: 800, max: 45_000, expCap: 6 },
    handshake: { base: 1_200, max: 30_000, expCap: 5 },
    silent: { base: 2_000, max: 60_000, expCap: 5 },
    rate_limit: { base: 8_000, max: 180_000, expCap: 4 },
    auth: { base: 12_000, max: 300_000, expCap: 4 },
    unknown: { base: 1_500, max: 60_000, expCap: 6 },
  };
  const cfg = table[kind];
  const n = Math.min(Math.max(attempt, 1), cfg.expCap);
  const exp = kind === "auth" ? Math.min(Math.max(authFailures, 1), cfg.expCap) : n;
  const ceiling = Math.min(cfg.base * 2 ** (exp - 1), cfg.max);
  return Math.max(Math.floor(cfg.base / 2), Math.floor(Math.random() * ceiling));
}

function streamUrl(): string {
  return (process.env.SSI_STREAMING_URL ?? DEFAULT_STREAM_URL).replace(/\/$/, "");
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

class SsiFcStreamEngine {
  private started = false;
  private state: SsiFcStreamState = "closed";
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
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private secBuckets = new Int16Array(60);
  private secBase = Math.floor(Date.now() / 1000);
  private topics = new Set<string>();
  private data = createFcStreamData();
  private subscribedSent = new Set<string>();
  private tokenExpiresAt: number | null = null;

  private enabled(): boolean {
    if (process.env.SSI_WS_DISABLED === "true") return false;
    return ssiFastConfigured();
  }

  /* ------------------------- subscription intents ------------------------- */

  subscribe(topic: string): () => void {
    const t = topic.trim();
    if (!t || !this.enabled()) return () => {};
    this.topics.add(t);
    this.start();
    if (this.state === "open" && !this.subscribedSent.has(t)) this.sendSubscribe([t]);
    return () => this.topics.delete(t);
  }

  /** trade + quote for one symbol (board bands come from market.<board>). */
  watchSymbol(symbol: string): () => void {
    const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!s) return () => {};
    const u1 = this.subscribe(`trade.${s}`);
    const u2 = this.subscribe(`quote.${s}`);
    return () => {
      u1();
      u2();
    };
  }

  /** Index codes stream over the same trade topics (trade.VNINDEX …). */
  watchIndex(code: string): () => void {
    const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!c) return () => {};
    void this.seedIndexRef(c);
    return this.subscribe(`trade.${c}`);
  }

  /** Whole-board coverage (trade.hose / trade.hnx / trade.upcom). */
  watchBoard(board: "hose" | "hnx" | "upcom"): () => void {
    return this.subscribe(`trade.${board}`);
  }

  watchBoardBands(board: "HOSE" | "HNX" | "UPCOM"): () => void {
    return this.subscribe(`market.${board.toLowerCase()}`);
  }

  ensureCoreIndices() {
    if (!this.enabled()) return;
    for (const code of ["VNINDEX", "VN30", "HNXINDEX", "UPCOMINDEX"]) this.watchIndex(code);
    this.watchBoardBands("HOSE");
  }

  private async seedIndexRef(code: string) {
    if (this.data.indexRefs.has(code)) return;
    try {
      const s: FcIndexSummary | null = await getFcIndexSummary(code);
      if (s?.indexValue != null && s.indexChange != null) {
        this.data.indexRefs.set(code, { prevClose: s.indexValue - s.indexChange, name: s.name });
        // seed a first index value so consumers don't wait for the first tick
        if (!this.data.indices.has(code)) {
          this.data.indices.set(code, {
            code,
            value: s.indexValue,
            change: s.indexChange,
            changePercent: s.indexChangePercentage,
            advances: s.advances,
            declines: s.declines,
            unchanged: s.noChange,
            volume: s.totalMatch,
            valueTraded: s.totalMatchValue,
            eventTime: s.tradingDateMs ?? Date.now(),
          });
        }
      }
    } catch {
      /* index ref unknown — live change stays null until ticks arrive */
    }
  }

  /** Seed market bands (ceiling/floor/ref) for a symbol list from REST masterdata. */
  seedMarketInfo(rows: { symbol: string; ceiling: number | null; floor: number | null; refPrice: number | null; exchange: string | null }[]) {
    for (const r of rows) {
      this.data.marketInfo.set(r.symbol.toUpperCase(), {
        ceiling: r.ceiling,
        floor: r.floor,
        ref: r.refPrice,
        board: r.exchange,
      });
    }
  }

  /* -------------------------------- reads --------------------------------- */

  getQuote(symbol: string, maxAgeMs = 30_000): SsiLiveQuote | null {
    const q = this.data.quotes.get(symbol.toUpperCase());
    return q && Date.now() - q.eventTime <= maxAgeMs ? q : null;
  }

  getIndex(code: string, maxAgeMs = 30_000): SsiLiveIndex | null {
    const q = this.data.indices.get(code.toUpperCase());
    return q && Date.now() - q.eventTime <= maxAgeMs ? q : null;
  }

  /** All fresh quotes (for full-board overlays). */
  getBoardQuotes(maxAgeMs = 60_000): SsiLiveQuote[] {
    const now = Date.now();
    return [...this.data.quotes.values()].filter((q) => now - q.eventTime <= maxAgeMs);
  }

  getMarketFlag(board: string): { flag: string; at: number } | null {
    return this.data.marketFlags.get(board.toUpperCase()) ?? null;
  }

  getStats(): SsiFcStreamStats {
    return {
      enabled: this.enabled(),
      configured: ssiFastConfigured(),
      state: this.enabled() ? this.state : "disabled",
      connectedAt: this.connectedAt,
      lastMessageAt: this.lastMessageAt,
      messagesPerMin: this.msgsPerMin(),
      reconnectAttempts: this.reconnectAttempts,
      authFailures: this.authFailures,
      lastError: this.lastError,
      lastFailKind: this.lastFailKind,
      nextRetryAt: this.nextRetryAt,
      topics: [...this.topics],
      quotesTracked: this.data.quotes.size,
      indicesTracked: this.data.indices.size,
    };
  }

  resetAuthCircuit() {
    this.authFailures = 0;
    this.reconnectAttempts = 0;
    this.lastFailKind = null;
    this.clearRetryTimer();
    invalidateFcToken();
    if (this.enabled()) void this.connect();
  }

  /* ------------------------------ lifecycle ------------------------------- */

  start() {
    if (!this.enabled()) {
      this.state = "disabled";
      return;
    }
    if (this.started) {
      if (this.state === "closed" || this.state === "blocked") void this.connect();
      return;
    }
    this.started = true;
    void this.connect();
    if (!this.watchdog) {
      this.watchdog = setInterval(() => this.checkLiveness(), 15_000);
      this.watchdog.unref?.();
    }
  }

  stop() {
    this.started = false;
    this.clearRetryTimer();
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
    this.hardClose();
    this.state = "closed";
  }

  private noteMsg(now = Date.now()) {
    this.lastMessageAt = now;
    const sec = Math.floor(now / 1000);
    if (sec !== this.secBase) {
      const drift = sec - this.secBase;
      if (drift >= 60) this.secBuckets.fill(0);
      else for (let i = 1; i <= drift; i++) this.secBuckets[(this.secBase + i) % 60] = 0;
      this.secBase = sec;
    }
    this.secBuckets[sec % 60]++;
  }

  private msgsPerMin(now = Date.now()): number {
    const sec = Math.floor(now / 1000);
    if (sec - this.secBase >= 60) return 0;
    let sum = 0;
    for (let i = 0; i < 60; i++) sum += this.secBuckets[i];
    return sum;
  }

  private hardClose() {
    const ws = this.ws;
    this.ws = null;
    this.subscribedSent.clear();
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (!ws) return;
    try {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.close();
    } catch {
      /* noop */
    }
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
      this.lastError = `auth circuit open after ${this.authFailures} failures — kiểm tra SSI_API_KEY/SECRET`;
      this.lastFailKind = "auth";
      return;
    }
    const WSImpl = (globalThis as { WebSocket?: new (url: string) => WsLike }).WebSocket;
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
      const bundle = await getFcAccessTokenBundle();
      if (gen !== this.connectGen) return;
      this.tokenExpiresAt = bundle.expiresAt;
      const url = `${streamUrl()}?access_token=${encodeURIComponent(bundle.accessToken)}`;
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
      }, 12_000);
      handshakeTimer.unref?.();

      ws.onopen = () => {
        if (gen !== this.connectGen) return;
        // Connection accepted — consider it open and subscribe everything.
        this.state = "open";
        this.connectedAt = Date.now();
        this.reconnectAttempts = 0;
        this.authFailures = 0;
        this.lastError = null;
        this.lastFailKind = null;
        recordSuccess(PROVIDER, 0);
        this.subscribedSent.clear();
        this.sendSubscribe([...this.topics]);
        this.startPing();
      };

      ws.onmessage = (e) => {
        if (gen !== this.connectGen) return;
        clearTimeout(handshakeTimer);
        this.onRawMessage(String(e.data ?? ""));
      };

      ws.onerror = (e) => {
        if (gen !== this.connectGen) return;
        this.lastError =
          e && typeof e === "object" && "message" in e
            ? String((e as { message: unknown }).message).slice(0, 200)
            : "websocket error";
      };

      ws.onclose = (ev) => {
        if (gen !== this.connectGen) return;
        clearTimeout(handshakeTimer);
        const reason = this.lastError ?? `close ${ev.code ?? ""} ${ev.reason ?? ""}`.trim();
        this.failAndReconnect(reason);
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "connect failed";
      if (classifyFail(msg) === "auth") {
        this.authFailures += 1;
        invalidateFcToken();
      }
      this.failAndReconnect(msg);
    } finally {
      this.connecting = false;
    }
  }

  private startPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (this.state !== "open" || !this.ws) return;
      try {
        this.ws.send(JSON.stringify({ method: "PING", channel: "HEARTBEAT", time: this.heartbeatTime() }));
      } catch {
        /* reconnect loop will take over */
      }
    }, PING_INTERVAL_MS);
    this.pingTimer.unref?.();
  }

  private heartbeatTime(): string {
    // dd-MM-yyyy HH-mm-ss (VN local time)
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    return `${get("day")}-${get("month")}-${get("year")} ${get("hour")}-${get("minute")}-${get("second")}`;
  }

  private failAndReconnect(reason: string) {
    if (this.retryScheduled && this.state === "retrying") return;

    const kind = classifyFail(reason);
    this.lastFailKind = kind;
    this.lastError = reason.slice(0, 240);
    this.state = kind === "auth" ? "blocked" : "closed";
    recordFailure(PROVIDER, this.lastError);
    this.subscribedSent.clear();
    this.ws = null;
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }

    if (!this.enabled()) return;

    if (kind === "auth") {
      this.authFailures += 1;
      invalidateFcToken();
    }
    if (this.authFailures >= MAX_AUTH_FAILS) {
      this.state = "blocked";
      this.lastError = `auth circuit open — ${this.lastError}`;
      this.clearRetryTimer();
      return;
    }

    this.reconnectAttempts += 1;
    if (this.reconnectAttempts > RETRY_BUDGET && kind !== "auth") {
      const cooldown = 5 * 60_000 + Math.floor(Math.random() * 30_000);
      this.state = "retrying";
      this.retryScheduled = true;
      this.nextRetryAt = Date.now() + cooldown;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.retryScheduled = false;
        this.reconnectAttempts = Math.floor(RETRY_BUDGET / 2);
        void this.connect();
      }, cooldown);
      this.timer.unref?.();
      return;
    }

    const delay = computeBackoffMs(kind, this.reconnectAttempts, this.authFailures);
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

  private checkLiveness() {
    if (!this.enabled()) return;
    // Proactive reconnect ~5 min before the embedded access token expires
    if (this.state === "open" && this.tokenExpiresAt && Date.now() > this.tokenExpiresAt - 5 * 60_000) {
      invalidateFcToken();
      this.hardClose();
      this.state = "closed";
      void this.connect();
      return;
    }
    if (this.state === "open" && this.lastMessageAt && Date.now() - this.lastMessageAt > SILENT_MS) {
      this.lastError = `stream silent > ${SILENT_MS / 1000}s — reconnect`;
      this.hardClose();
      this.failAndReconnect(this.lastError);
      return;
    }
    if (this.state === "blocked" && this.authFailures >= MAX_AUTH_FAILS) return;
    if (
      (this.state === "closed" || this.state === "blocked") &&
      this.topics.size > 0 &&
      !this.connecting &&
      !this.retryScheduled
    ) {
      void this.connect();
    }
    const now = Date.now();
    for (const [k, v] of this.data.quotes) if (now - v.eventTime > 300_000) this.data.quotes.delete(k);
    for (const [k, v] of this.data.indices) if (now - v.eventTime > 300_000) this.data.indices.delete(k);
  }

  /* ------------------------------ messaging ------------------------------- */

  private sendSubscribe(topics: string[]) {
    if (!this.ws || this.state !== "open" || !topics.length) return;
    const pending = topics.filter((t) => !this.subscribedSent.has(t));
    for (const batch of chunk(pending, 50)) {
      try {
        const channel = batch[0].startsWith("order.") || batch[0].startsWith("portfolio.") ? "TRADING" : "DATA";
        this.ws.send(JSON.stringify({ method: "SUBSCRIBE", channel, topics: batch }));
        for (const t of batch) this.subscribedSent.add(t);
      } catch {
        for (const t of batch) this.subscribedSent.delete(t);
      }
    }
  }

  private onRawMessage(raw: string) {
    if (!raw) return;
    this.noteMsg();
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    this.handleMessage(msg);
  }

  private handleMessage(msg: Record<string, unknown>) {
    const method = String(msg.method ?? "").toUpperCase();
    const channel = String(msg.channel ?? "").toUpperCase();

    if (channel === "HEARTBEAT" || method === "PING" || method === "PING_PONG") {
      if (method === "PING" || method === "PING_PONG") {
        // server ping → pong back to keep the session alive
        if (this.ws && this.state === "open") {
          try {
            this.ws.send(
              JSON.stringify({ method: "PONG", channel: "HEARTBEAT", time: String(msg.time ?? this.heartbeatTime()) }),
            );
          } catch {
            /* noop */
          }
        }
      }
      return;
    }

    if (method === "LIST_SUBSCRIPTION") return;

    // subscribe ack / error messages
    if (msg.error != null || msg.code != null) {
      const text = String(msg.error ?? msg.msg ?? msg.message ?? "");
      if (text && classifyFail(text) === "auth") {
        this.authFailures += 1;
        invalidateFcToken();
        this.hardClose();
        this.failAndReconnect(text);
      } else if (text) {
        this.lastError = text.slice(0, 240);
      }
      return;
    }

    if (channel === "DATA" || channel === "TRADING") {
      fcStreamIngest(this.data, msg as { channel?: unknown; topic?: unknown; data?: unknown });
    }
  }
}

const g = globalThis as typeof globalThis & { __orcaSsiFcStream?: SsiFcStreamEngine };
export const ssiFcStream = g.__orcaSsiFcStream ?? new SsiFcStreamEngine();
g.__orcaSsiFcStream = ssiFcStream;

export function ensureSsiFcStreamStarted() {
  ssiFcStream.start();
  if (ssiFastConfigured() && process.env.SSI_WS_DISABLED !== "true") {
    ssiFcStream.ensureCoreIndices();
  }
}
