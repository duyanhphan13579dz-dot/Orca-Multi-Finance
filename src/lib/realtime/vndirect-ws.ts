import "server-only";
import { recordFailure, recordSuccess } from "../health";
import { eventBus } from "../events";

/**
 * VNDirect public realtime price feed (no API key).
 *
 * Protocol (community / VNDIRECT price-feed sample):
 *   wss://price-cmc-*.vndirect.com.vn/realtime/websocket
 *   subscribe: { type: "registConsumer", data: { sequence, params: { name, codes } } }
 *   message types: SP (match), BA (bid/ask), MI (index)
 *   payload: { type, data: "field|field|..." }
 *
 * Emits into the existing market-tick pipeline:
 *   vndirect:quote:{SYMBOL}
 *   vndirect:index:{CODE}
 *
 * On serverless set VNDIRECT_WS_DISABLED=true (connection cannot stay alive).
 */

const PROVIDER = "vndirect-ws";
const DEFAULT_URL = "wss://price-cmc-04.vndirect.com.vn/realtime/websocket";
const SILENT_MS = 45_000;
const MAX_CODES_PER_SUBSCRIBE = 80;

/** MI marketID → canonical index code used across ORCA */
const MI_CODE_MAP: Record<string, string> = {
  "10": "VNINDEX",
  "11": "VN30",
  "12": "HNX30",
  "13": "VNXALL",
  "02": "HNX",
  "03": "UPCOM",
};

const CORE_MI_IDS = Object.keys(MI_CODE_MAP);

export type VndirectWsState = "open" | "connecting" | "closed" | "disabled" | "retrying";

export interface VndirectLiveQuote {
  symbol: string;
  price: number;
  volume: number;
  value: number;
  open: number | null;
  high: number | null;
  low: number | null;
  matchQtty: number | null;
  eventTime: number;
  source: "SP" | "BA";
}

export interface VndirectLiveIndex {
  code: string;
  value: number;
  change: number | null;
  volume: number | null;
  valueTraded: number | null;
  advances: number | null;
  declines: number | null;
  unchanged: number | null;
  eventTime: number;
}

export interface VndirectWsStats {
  enabled: boolean;
  state: VndirectWsState;
  connectedAt: number | null;
  lastMessageAt: number | null;
  messagesPerMin: number;
  reconnectAttempts: number;
  lastError: string | null;
  nextRetryAt: number | null;
  symbolsTracked: number;
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

function wsUrl(): string {
  return (process.env.VNDIRECT_WS_URL ?? DEFAULT_URL).trim();
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
  return (mins >= 8 * 60 + 45 && mins <= 11 * 60 + 45) || (mins >= 12 * 60 + 45 && mins <= 15 * 60 + 15);
}

class VndirectWsEngine {
  private started = false;
  private state: VndirectWsState = "closed";
  private ws: WsLike | null = null;
  private connectGen = 0;
  private connecting = false;
  private connectedAt: number | null = null;
  private lastMessageAt: number | null = null;
  private reconnectAttempts = 0;
  private lastError: string | null = null;
  private nextRetryAt: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private secBuckets = new Int16Array(60);
  private secBase = Math.floor(Date.now() / 1000);
  private symbolRefs = new Map<string, number>();
  private quotes = new Map<string, VndirectLiveQuote>();
  private indices = new Map<string, VndirectLiveIndex>();
  private miSubscribed = false;
  private forceOn = false;

  forceEnable(on = true) {
    this.forceOn = on;
    if (on && (this.state === "closed" || this.state === "disabled")) void this.connect();
  }

  private enabled(): boolean {
    if (this.forceOn) return true;
    if (process.env.VNDIRECT_WS_DISABLED === "true") return false;
    return true;
  }

  watchSymbol(symbol: string): () => void {
    const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!s) return () => {};
    const n = (this.symbolRefs.get(s) ?? 0) + 1;
    this.symbolRefs.set(s, n);
    if (n === 1 && this.state === "open") this.sendSubscribe(["SP", "BA"], [s]);
    if (this.state !== "open" && this.state !== "connecting") void this.connect();
    return () => {
      const left = (this.symbolRefs.get(s) ?? 1) - 1;
      if (left <= 0) this.symbolRefs.delete(s);
      else this.symbolRefs.set(s, left);
    };
  }

  ensureCoreIndices() {
    if (this.state === "open" && !this.miSubscribed) {
      this.sendSubscribe(["MI"], CORE_MI_IDS);
      this.miSubscribed = true;
    }
  }

  getQuote(symbol: string, maxAgeMs = 30_000): VndirectLiveQuote | null {
    const q = this.quotes.get(symbol.toUpperCase());
    return q && Date.now() - q.eventTime <= maxAgeMs ? q : null;
  }

  getIndex(code: string, maxAgeMs = 30_000): VndirectLiveIndex | null {
    const idx = this.indices.get(code.toUpperCase());
    return idx && Date.now() - idx.eventTime <= maxAgeMs ? idx : null;
  }

  getStats(): VndirectWsStats {
    return {
      enabled: this.enabled(),
      state: this.state,
      connectedAt: this.connectedAt,
      lastMessageAt: this.lastMessageAt,
      messagesPerMin: this.msgsPerMin(),
      reconnectAttempts: this.reconnectAttempts,
      lastError: this.lastError,
      nextRetryAt: this.nextRetryAt,
      symbolsTracked: this.symbolRefs.size,
      quotesTracked: this.quotes.size,
      indicesTracked: this.indices.size,
    };
  }

  start() {
    if (this.started) {
      if (this.state === "closed" || this.state === "disabled") void this.connect();
      return;
    }
    this.started = true;
    void this.connect();
    this.watchdog = setInterval(() => this.checkLiveness(), 10_000);
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
    this.miSubscribed = false;
  }

  private clearRetryTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.nextRetryAt = null;
  }

  private async connect() {
    if (!this.enabled()) {
      this.state = "disabled";
      return;
    }
    if (this.connecting) return;

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
      const url = wsUrl();
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
      }, 8_000);
      handshakeTimer.unref?.();

      ws.onopen = () => {
        if (gen !== this.connectGen) return;
        clearTimeout(handshakeTimer);
        this.connecting = false;
        this.state = "open";
        this.connectedAt = Date.now();
        this.reconnectAttempts = 0;
        this.lastError = null;
        recordSuccess(PROVIDER, 0, "realtime");
        this.resubscribeAll();
      };

      ws.onmessage = (e) => {
        if (gen !== this.connectGen) return;
        clearTimeout(handshakeTimer);
        this.noteMsg();
        const raw = typeof e.data === "string" ? e.data : String(e.data ?? "");
        this.handleMessage(raw);
      };

      ws.onerror = () => {
        if (gen !== this.connectGen) return;
        clearTimeout(handshakeTimer);
        this.failAndReconnect("websocket error");
      };

      ws.onclose = (ev) => {
        if (gen !== this.connectGen) return;
        clearTimeout(handshakeTimer);
        this.connecting = false;
        this.ws = null;
        this.miSubscribed = false;
        this.failAndReconnect(`closed ${ev.code ?? ""} ${ev.reason ?? ""}`.trim());
      };
    } catch (err) {
      this.connecting = false;
      this.failAndReconnect(err instanceof Error ? err.message : "connect failed");
    }
  }

  private resubscribeAll() {
    const symbols = [...this.symbolRefs.keys()];
    for (let i = 0; i < symbols.length; i += MAX_CODES_PER_SUBSCRIBE) {
      const chunk = symbols.slice(i, i + MAX_CODES_PER_SUBSCRIBE);
      this.sendSubscribe(["SP", "BA"], chunk);
    }
    this.sendSubscribe(["MI"], CORE_MI_IDS);
    this.miSubscribed = true;
  }

  private sendSubscribe(types: string[], codes: string[]) {
    if (!this.ws || this.state !== "open" || !codes.length) return;
    for (const name of types) {
      try {
        this.ws.send(
          JSON.stringify({
            type: "registConsumer",
            data: {
              sequence: 0,
              params: { name, codes },
            },
          }),
        );
      } catch (e) {
        this.lastError = e instanceof Error ? e.message : "subscribe send failed";
      }
    }
  }

  private handleMessage(raw: string) {
    if (!raw || raw === "ping" || raw === "pong") return;
    let obj: { type?: string; data?: unknown };
    try {
      obj = JSON.parse(raw) as { type?: string; data?: unknown };
    } catch {
      return;
    }
    const type = String(obj.type ?? "").toUpperCase();
    const dataStr = typeof obj.data === "string" ? obj.data : null;
    if (!dataStr) return;
    const parts = dataStr.split("|");

    if (type === "SP") this.onStockPartial(parts);
    else if (type === "BA") this.onBidAsk(parts);
    else if (type === "MI") this.onMarketInfo(parts);
  }

  private onStockPartial(arr: string[]) {
    if (arr.length < 12) return;
    const symbol = String(arr[3] ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    if (!symbol) return;
    const price = num(arr[11]) ?? num(arr[10]);
    if (price == null || price <= 0) return;
    const volume = num(arr[12]) ?? 0;
    const value = num(arr[18]) ?? 0;
    const q: VndirectLiveQuote = {
      symbol,
      price,
      volume: Math.max(0, volume),
      value: Math.max(0, value),
      open: num(arr[9]),
      high: num(arr[13]),
      low: num(arr[14]),
      matchQtty: num(arr[12]),
      eventTime: Date.now(),
      source: "SP",
    };
    this.quotes.set(symbol, q);
    eventBus.emit(`vndirect:quote:${symbol}`, {
      symbol,
      price: q.price,
      volume: q.volume,
      value: q.value,
      eventTime: q.eventTime,
      ts: q.eventTime,
    });
  }

  private onBidAsk(arr: string[]) {
    if (arr.length < 16) return;
    const symbol = String(arr[1] ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    if (!symbol) return;
    const price = num(arr[15]);
    if (price == null || price <= 0) return;
    const volume = num(arr[14]) ?? 0;
    const value = num(arr[17]) ?? 0;
    const prev = this.quotes.get(symbol);
    const q: VndirectLiveQuote = {
      symbol,
      price,
      volume: Math.max(0, volume),
      value: Math.max(0, value),
      open: prev?.open ?? null,
      high: prev?.high ?? null,
      low: prev?.low ?? null,
      matchQtty: num(arr[16]),
      eventTime: Date.now(),
      source: "BA",
    };
    this.quotes.set(symbol, q);
    eventBus.emit(`vndirect:quote:${symbol}`, {
      symbol,
      price: q.price,
      volume: q.volume,
      value: q.value,
      eventTime: q.eventTime,
      ts: q.eventTime,
    });
  }

  private onMarketInfo(arr: string[]) {
    if (arr.length < 13) return;
    const marketId = String(arr[0] ?? "").trim();
    const code = (MI_CODE_MAP[marketId] ?? String(arr[11] ?? "").toUpperCase()).replace(/[^A-Z0-9]/g, "");
    if (!code) return;
    const value = num(arr[12]) ?? num(arr[7]);
    if (value == null || value <= 0) return;
    const idx: VndirectLiveIndex = {
      code,
      value,
      change: num(arr[8]),
      volume: num(arr[2]) ?? num(arr[16]),
      valueTraded: num(arr[3]),
      advances: num(arr[4]),
      declines: num(arr[5]),
      unchanged: num(arr[6]),
      eventTime: Date.now(),
    };
    this.indices.set(code, idx);
    eventBus.emit(`vndirect:index:${code}`, {
      code,
      symbol: code,
      price: idx.value,
      value: idx.value,
      volume: idx.volume ?? 0,
      eventTime: idx.eventTime,
      ts: idx.eventTime,
    });
  }

  private checkLiveness() {
    if (!this.enabled()) return;
    if (this.state !== "open") {
      if (!this.connecting && !this.timer) void this.connect();
      return;
    }
    const last = this.lastMessageAt ?? this.connectedAt ?? 0;
    const silentLimit = isVnSessionWindow() ? 25_000 : SILENT_MS;
    if (Date.now() - last > silentLimit) {
      this.failAndReconnect("silent timeout");
    }
  }

  private failAndReconnect(reason: string) {
    this.connecting = false;
    this.lastError = reason.slice(0, 240);
    this.state = "closed";
    recordFailure(PROVIDER, this.lastError, "realtime");
    this.hardClose();

    if (!this.enabled()) {
      this.clearRetryTimer();
      this.state = "disabled";
      return;
    }
    if (this.timer) return;

    this.reconnectAttempts += 1;
    this.state = "retrying";
    const attempt = Math.min(this.reconnectAttempts, 8);
    const base = isVnSessionWindow() ? 400 : 1_500;
    const delay = Math.min(base * 2 ** (attempt - 1), 60_000);
    const jitter = Math.floor(delay * (0.4 + Math.random() * 0.6));
    this.nextRetryAt = Date.now() + jitter;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.nextRetryAt = null;
      void this.connect();
    }, jitter);
    this.timer.unref?.();
  }
}

function getEngine(): VndirectWsEngine {
  const g = globalThis as typeof globalThis & { __orcaVndirectWs?: VndirectWsEngine };
  if (!g.__orcaVndirectWs) g.__orcaVndirectWs = new VndirectWsEngine();
  return g.__orcaVndirectWs;
}

export const vndirectWs = getEngine();

export function ensureVndirectWsStarted() {
  if (process.env.VNDIRECT_WS_DISABLED === "true") return;
  vndirectWs.start();
  vndirectWs.ensureCoreIndices();
}
