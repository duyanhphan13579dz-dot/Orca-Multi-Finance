import "server-only";
import { recordFailure, recordSuccess } from "../health";
import { eventBus } from "../events";
import { getSsiAccessToken, invalidateSsiToken, ssiFcConfigured } from "../providers/ssi-fcdata";

/**
 * SSI FastConnect DataHub streaming — zero-config when env keys present.
 *
 * Env:
 *   SSI_FC_CONSUMER_ID / SSI_FC_CONSUMER_SECRET  (required)
 *   SSI_FC_HUB_URL                                (optional)
 *   SSI_WS_DISABLED=true                          (serverless)
 */

const RS = "\x1e";
const DEFAULT_HUB = "https://fc-datahub.ssi.com.vn/v2.0";
const PROVIDER = "ssi-ws";
const MAX_AUTH_FAILS = 5;
const SILENT_MS = 90_000;

export type SsiWsState = "open" | "connecting" | "closed" | "blocked" | "disabled" | "retrying";

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

function isAuthError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("401") ||
    m.includes("unauthorized") ||
    m.includes("token") ||
    m.includes("auth") ||
    m.includes("credential") ||
    m.includes("access denied")
  );
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

  /** Ensure core indices are streaming when SSI is live. */
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

  private async connect() {
    if (!this.enabled()) {
      this.state = "disabled";
      return;
    }
    if (this.connecting) return;
    if (this.authFailures >= MAX_AUTH_FAILS) {
      this.state = "blocked";
      this.lastError = `auth circuit open after ${this.authFailures} failures — check SSI keys`;
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
    const gen = ++this.connectGen;
    this.hardClose();

    try {
      const token = await getSsiAccessToken();
      if (gen !== this.connectGen) return; // superseded

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
      if (isAuthError(msg)) {
        this.authFailures += 1;
        invalidateSsiToken();
      }
      this.failAndReconnect(msg);
    } finally {
      this.connecting = false;
    }
  }

  private failAndReconnect(reason: string) {
    this.lastError = reason.slice(0, 240);
    this.state = isAuthError(reason) ? "blocked" : "closed";
    recordFailure(PROVIDER, this.lastError);
    this.subscribedSent.clear();
    this.ws = null;

    if (!this.enabled()) return;
    if (this.authFailures >= MAX_AUTH_FAILS) {
      this.state = "blocked";
      this.lastError = `auth circuit open — ${this.lastError}`;
      return;
    }

    this.reconnectAttempts += 1;
    // Auth errors: longer backoff; network: exponential up to 60s
    const authSlow = isAuthError(reason);
    const base = authSlow
      ? Math.min(15_000 * 2 ** Math.min(this.authFailures, 4), 300_000)
      : Math.min(1500 * 2 ** Math.min(this.reconnectAttempts, 6), 60_000);
    const delay = base + Math.random() * 800;
    this.state = "retrying";
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.connect(), delay);
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
    // Recover from blocked if auth failures cooled (manual key fix)
    if (this.state === "blocked" && this.authFailures >= MAX_AUTH_FAILS) {
      // stay blocked until process restart or resetAuthCircuit()
      return;
    }
    if ((this.state === "closed" || this.state === "blocked") && this.channelRefs.size > 0 && !this.connecting) {
      void this.connect();
    }
    const now = Date.now();
    for (const [k, v] of this.quotes) if (now - v.eventTime > 300_000) this.quotes.delete(k);
    for (const [k, v] of this.indices) if (now - v.eventTime > 300_000) this.indices.delete(k);
  }

  /** Call after fixing credentials without redeploy. */
  resetAuthCircuit() {
    this.authFailures = 0;
    this.reconnectAttempts = 0;
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

      if (msg.error && isAuthError(String(msg.error))) {
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
