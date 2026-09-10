import "server-only";
import { recordFailure, recordSuccess } from "../health";
import { eventBus } from "../events";
import { getSsiAccessToken, invalidateSsiToken, ssiFcConfigured } from "../providers/ssi-fcdata";

/**
 * SSI FastConnect DataHub streaming — zero-config when env keys present.
 *
 * Backoff: full-jitter exponential by error class (network / handshake /
 * rate-limit / auth / silent). Retry budget + auth circuit breaker.
 */

const RS = "\x1e";
const DEFAULT_HUB = "https://fc-datahub.ssi.com.vn/v2.0";
const PROVIDER = "ssi-ws";
const MAX_AUTH_FAILS = 5;
const SILENT_MS = 90_000;
/** After this many consecutive network reconnects, enter long cooldown then soft-reset. */
const RETRY_BUDGET = 24;

export type SsiWsState = "open" | "connecting" | "closed" | "blocked" | "disabled" | "retrying";

type FailKind = "network" | "handshake" | "rate_limit" | "auth" | "silent" | "unknown";

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

/** Full-jitter exponential backoff (AWS style). */
function computeBackoffMs(kind: FailKind, attempt: number, authFailures: number): number {
  // [base, max] per class
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
  // Auth uses authFailures so successive bad keys slow harder
  const exp =
    kind === "auth" ? Math.min(Math.max(authFailures, 1), cfg.expCap) : n;
  const ceiling = Math.min(cfg.base * 2 ** (exp - 1), cfg.max);
  // full jitter: uniform(0, ceiling)
  const jittered = Math.floor(Math.random() * ceiling);
  // floor so we never spin-retry faster than ~base/2
  return Math.max(Math.floor(cfg.base / 2), jittered);
}

/** True during VN equity session-ish hours (Mon–Fri 08:30–15:15 +07). */
function isVnSessionWindow(now = Date.now()): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(now));
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  if (wd === "Sat" || wd === "Sun") return false;
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const mins = hh * 60 + mm;
  return mins >= 8 * 60 + 30 && mins <= 15 * 60 + 15;
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
  private indices = new Map<string, SsiLiveIndex>();
  private invocationId = 0;
  private subscribedSent = new Set<string>();

  private enabled(): boolean {
    if (process.env.SSI_WS_DISABLED === "true") return false;
    return ssiFcConfigured();
  }

  subscribe(channel: string): () => void {
    if (!this.enabled()) return () => {};
    const ch = channel.trim().toUpperCase();
    if (!ch) return () => {};
    this.channelRefs.set(ch, (this.channelRefs.get(ch) ?? 0) + 1);
    this.start();
    if (this.state === "open" && !this.subscribedSent.has(ch)) this.sendSubscribe([ch]);
    return () => {
      const n = (this.channelRefs.get(ch) ?? 0) - 1;
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
    if (!this.enabled()) return;
    for (const code of ["VNINDEX", "VN30", "HNX", "UPCOM", "HNX30"]) {
      this.watchIndex(code);
    }
  }

  getQuote(symbol: string, maxAgeMs = 30_000): SsiLiveQuote | null {
    const q = this.quotes.get(symbol.toUpperCase());
    return q && Date.now() - q.eventTime <= maxAgeMs ? q : null;
  }

  getIndex(code: string, maxAgeMs = 30_000): SsiLiveIndex | null {
    const q = this.indices.get(code.toUpperCase());
    return q && Date.now() - q.eventTime <= maxAgeMs ? q : null;
  }

  getStats(): SsiWsStats {
    return {
      enabled: this.enabled(),
      configured: ssiFcConfigured(),
      state: this.enabled() ? this.state : "disabled",
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
      indicesTracked: this.indices.size,
    };
  }

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
      }, 12_000);
      handshakeTimer.unref?.();

      ws.onopen = () => {
        if (gen !== this.connectGen) return;
        try {
          ws.send(`${JSON.stringify({ protocol: "json", version: 1 })}${RS}`);
        } catch (e) {
          this.lastError = e instanceof Error ? e.message : "handshake send failed";
        }
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
        invalidateSsiToken();
      }
      this.failAndReconnect(msg);
    } finally {
      this.connecting = false;
    }
  }

  private failAndReconnect(reason: string) {
    // Debounce: only one scheduled retry at a time
    if (this.retryScheduled && this.state === "retrying") return;

    const kind = classifyFail(reason);
    this.lastFailKind = kind;
    this.lastError = reason.slice(0, 240);
    this.state = kind === "auth" ? "blocked" : "closed";
    recordFailure(PROVIDER, this.lastError);
    this.subscribedSent.clear();
    this.ws = null;

    if (!this.enabled()) return;

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

    // Retry budget exhausted → long cooldown then soft-reset attempt counter
    if (this.reconnectAttempts > RETRY_BUDGET && kind !== "auth") {
      const cooldown = 5 * 60_000 + Math.floor(Math.random() * 30_000);
      this.state = "retrying";
      this.retryScheduled = true;
      this.nextRetryAt = Date.now() + cooldown;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.retryScheduled = false;
        this.reconnectAttempts = Math.floor(RETRY_BUDGET / 2); // soft reset
        void this.connect();
      }, cooldown);
      this.timer.unref?.();
      return;
    }

    let delay = computeBackoffMs(kind, this.reconnectAttempts, this.authFailures);

    // During market hours, prefer slightly snappier recovery for network blips
    if (isVnSessionWindow() && (kind === "network" || kind === "silent" || kind === "handshake")) {
      delay = Math.floor(delay * 0.7);
    }

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
    if (this.state === "open" && this.lastMessageAt && Date.now() - this.lastMessageAt > SILENT_MS) {
      this.lastError = `stream silent > ${SILENT_MS / 1000}s — reconnect`;
      this.hardClose();
      this.failAndReconnect(this.lastError);
      return;
    }
    if (this.state === "blocked" && this.authFailures >= MAX_AUTH_FAILS) return;
    if (
      (this.state === "closed" || this.state === "blocked") &&
      this.channelRefs.size > 0 &&
      !this.connecting &&
      !this.retryScheduled
    ) {
      void this.connect();
    }
    const now = Date.now();
    for (const [k, v] of this.quotes) if (now - v.eventTime > 300_000) this.quotes.delete(k);
    for (const [k, v] of this.indices) if (now - v.eventTime > 300_000) this.indices.delete(k);
  }

  resetAuthCircuit() {
    this.authFailures = 0;
    this.reconnectAttempts = 0;
    this.lastFailKind = null;
    this.clearRetryTimer();
    invalidateSsiToken();
    if (this.enabled()) void this.connect();
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
      if (content) this.applyContent(dt || String(content.RType ?? content.Rtype ?? "").toUpperCase(), content);
      return;
    }

    if (typeof arg === "string") {
      try {
        this.ingestPayload(JSON.parse(arg));
      } catch {
        /* ignore */
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
        ceiling: num(c.Ceiling) ?? prev?.ceiling ?? null,
        floor: num(c.Floor) ?? prev?.floor ?? null,
        ref: num(c.RefPrice) ?? prev?.ref ?? null,
        session: typeof c.TradingSession === "string" ? c.TradingSession : prev?.session ?? null,
        eventTime: now,
        source: rtype === "X-TRADE" ? "X-TRADE" : "X",
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
