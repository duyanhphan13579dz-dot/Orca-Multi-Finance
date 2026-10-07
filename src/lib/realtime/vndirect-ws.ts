import "server-only";
import { recordFailure, recordSuccess } from "../health";
import { eventBus } from "../events";

/**
 * VNDirect public realtime price feed — low-latency reconnect.
 * Multi-host CMC rotation, 14s session silent, ~15ms first hop.
 * On serverless set VNDIRECT_WS_DISABLED=true.
 */

const PROVIDER = "vndirect-ws";
const VND_WS_HOSTS = [
  "wss://price-cmc-04.vndirect.com.vn/realtime/websocket",
  "wss://price-cmc-03.vndirect.com.vn/realtime/websocket",
  "wss://price-cmc-02.vndirect.com.vn/realtime/websocket",
  "wss://price-cmc-01.vndirect.com.vn/realtime/websocket",
  "wss://price-cmc-05.vndirect.com.vn/realtime/websocket",
];
const DEFAULT_URL = VND_WS_HOSTS[0]!;
const SILENT_MS = 30_000;
const SILENT_MS_SESSION = 14_000;
const SILENT_MS_OFFHOURS = 90_000;
const HANDSHAKE_MS = 5_000;
const MAX_CODES_PER_SUBSCRIBE = 80;
const RETRY_BUDGET = 32;
const BUDGET_COOLDOWN_MS = 20_000;
const URGENT_MS = 40;
const WATCHDOG_MS = 4_000;

const MI_CODE_MAP: Record<string, string> = {
  "10": "VNINDEX", "11": "VN30", "12": "HNX30", "13": "VNXALL", "02": "HNX", "03": "UPCOM",
};
const CORE_MI_IDS = Object.keys(MI_CODE_MAP);

export type VndirectWsState = "open" | "connecting" | "closed" | "disabled" | "retrying";
type FailKind = "network" | "handshake" | "silent" | "rate_limit" | "unknown";

export interface VndirectLiveQuote {
  symbol: string; price: number; volume: number; value: number;
  open: number | null; high: number | null; low: number | null;
  matchQtty: number | null; eventTime: number; source: "SP" | "BA";
}
export interface VndirectLiveIndex {
  code: string; value: number; change: number | null; volume: number | null;
  valueTraded: number | null; advances: number | null; declines: number | null;
  unchanged: number | null; eventTime: number;
}
export interface VndirectWsStats {
  enabled: boolean; state: VndirectWsState; connectedAt: number | null;
  lastMessageAt: number | null; messagesPerMin: number; reconnectAttempts: number;
  lastError: string | null; lastFailKind: FailKind | null; nextRetryAt: number | null;
  symbolsTracked: number; quotesTracked: number; indicesTracked: number;
}

type WsLike = {
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onclose: ((e: { code?: number; reason?: string }) => void) | null;
  close: () => void; send: (data: string) => void; readyState?: number;
};

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(String(v).replace(/,/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};

let _hostIdx = 0;
let _lastGoodHost: string | null = null;

function wsUrl(): string {
  const env = process.env.VNDIRECT_WS_URL?.trim();
  if (env) return env;
  if (_lastGoodHost) return _lastGoodHost;
  return VND_WS_HOSTS[_hostIdx % VND_WS_HOSTS.length]!;
}
function rotateWsHost() {
  if (process.env.VNDIRECT_WS_URL?.trim()) return;
  _lastGoodHost = null;
  _hostIdx = (_hostIdx + 1) % VND_WS_HOSTS.length;
}
function markWsHostGood(url: string) {
  if (!process.env.VNDIRECT_WS_URL?.trim()) _lastGoodHost = url;
}

function isVnSessionWindow(d = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  if (get("weekday") === "Sat" || get("weekday") === "Sun") return false;
  const mins = Number(get("hour")) * 60 + Number(get("minute"));
  return (mins >= 8 * 60 + 45 && mins <= 11 * 60 + 45) || (mins >= 12 * 60 + 45 && mins <= 15 * 60 + 15);
}

function classifyFail(reason: string): FailKind {
  const m = reason.toLowerCase();
  if (m.includes("429") || m.includes("rate") || m.includes("throttl") || m.includes("quota")) return "rate_limit";
  if (m.includes("handshake") || m.includes("protocol")) return "handshake";
  if (m.includes("silent")) return "silent";
  if (m.includes("timeout") || m.includes("econn") || m.includes("network") || m.includes("socket") || m.includes("closed") || m.includes("close") || m.includes("reset") || m.includes("websocket error")) return "network";
  return "unknown";
}

function computeBackoffMs(kind: FailKind, attempt: number, inSession: boolean): number {
  const table: Record<FailKind, { base: number; max: number; expCap: number }> = {
    network: { base: 60, max: inSession ? 4_000 : 15_000, expCap: 7 },
    handshake: { base: 100, max: inSession ? 5_000 : 15_000, expCap: 6 },
    silent: { base: 120, max: inSession ? 6_000 : 20_000, expCap: 6 },
    rate_limit: { base: 5_000, max: 90_000, expCap: 4 },
    unknown: { base: 200, max: inSession ? 10_000 : 25_000, expCap: 6 },
  };
  const cfg = table[kind];
  const n = Math.min(Math.max(attempt, 1), cfg.expCap);
  if (kind !== "rate_limit" && n <= 3) {
    if (n === 1) return 15 + Math.floor(Math.random() * 35);
    if (n === 2) return 40 + Math.floor(Math.random() * 80);
    return 80 + Math.floor(Math.random() * 120);
  }
  const ceiling = Math.min(cfg.base * 2 ** (n - 1), cfg.max);
  return Math.max(Math.floor(cfg.base / 2), Math.floor(ceiling * (0.35 + Math.random() * 0.65)));
}

class VndirectWsEngine {
  private started = false;
  private state: VndirectWsState = "closed";
  private ws: WsLike | null = null;
  private connectGen = 0;
  private closeGen = 0;
  private connecting = false;
  private connectedAt: number | null = null;
  private lastMessageAt: number | null = null;
  private reconnectAttempts = 0;
  private lastError: string | null = null;
  private lastFailKind: FailKind | null = null;
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
    if (this.state !== "open" && this.state !== "connecting") this.reconnectUrgent("watchSymbol");
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
      enabled: this.enabled(), state: this.state, connectedAt: this.connectedAt,
      lastMessageAt: this.lastMessageAt, messagesPerMin: this.msgsPerMin(),
      reconnectAttempts: this.reconnectAttempts, lastError: this.lastError,
      lastFailKind: this.lastFailKind, nextRetryAt: this.nextRetryAt,
      symbolsTracked: this.symbolRefs.size, quotesTracked: this.quotes.size, indicesTracked: this.indices.size,
    };
  }
  start() {
    if (this.started) {
      if (this.state === "closed" || this.state === "disabled") void this.connect();
      return;
    }
    this.started = true;
    void this.connect();
    this.watchdog = setInterval(() => this.checkLiveness(), WATCHDOG_MS);
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
    for (let i = 0; i < 60; i++) if (sec - i >= this.secBase - 59) sum += this.secBuckets[(sec - i) % 60] ?? 0;
    return sum;
  }
  private hardClose() {
    ++this.closeGen;
    const ws = this.ws;
    this.ws = null;
    this.miSubscribed = false;
    if (!ws) return;
    try { ws.onopen = null; ws.onmessage = null; ws.onerror = null; ws.onclose = null; ws.close(); } catch { /* */ }
  }
  private clearRetryTimer() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.nextRetryAt = null;
  }
  private async connect() {
    if (!this.enabled()) { this.state = "disabled"; return; }
    if (this.connecting) return;
    const WSImpl = (globalThis as { WebSocket?: new (url: string) => WsLike }).WebSocket;
    if (!WSImpl) { this.state = "disabled"; this.lastError = "no native WebSocket in runtime"; return; }
    this.connecting = true;
    this.state = "connecting";
    this.clearRetryTimer();
    const gen = ++this.connectGen;
    this.hardClose();
    try {
      const url = wsUrl();
      const ws = new WSImpl(url);
      this.ws = ws;
      const myCloseGen = this.closeGen;
      const handshakeTimer = setTimeout(() => {
        if (gen !== this.connectGen) return;
        if (this.state === "connecting") {
          this.lastError = "handshake timeout";
          try { ws.close(); } catch { this.failAndReconnect("handshake timeout"); }
        }
      }, HANDSHAKE_MS);
      handshakeTimer.unref?.();
      ws.onopen = () => {
        if (gen !== this.connectGen) return;
        clearTimeout(handshakeTimer);
        this.connecting = false;
        this.state = "open";
        this.connectedAt = Date.now();
        this.lastMessageAt = Date.now();
        this.reconnectAttempts = 0;
        this.lastError = null;
        this.lastFailKind = null;
        recordSuccess(PROVIDER, 0, "realtime");
        try { markWsHostGood(url); } catch { /* */ }
        this.resubscribeAll();
      };
      ws.onmessage = (e) => {
        if (gen !== this.connectGen) return;
        clearTimeout(handshakeTimer);
        this.noteMsg();
        this.handleMessage(typeof e.data === "string" ? e.data : String(e.data ?? ""));
      };
      ws.onerror = () => {
        if (gen !== this.connectGen || myCloseGen !== this.closeGen) return;
        clearTimeout(handshakeTimer);
        if (this.state === "connecting") this.failAndReconnect("websocket error");
      };
      ws.onclose = (ev) => {
        if (gen !== this.connectGen || myCloseGen !== this.closeGen) return;
        clearTimeout(handshakeTimer);
        this.connecting = false;
        this.ws = null;
        this.miSubscribed = false;
        this.failAndReconnect(`closed ${ev.code ?? ""} ${ev.reason ?? ""}`.trim() || "closed");
      };
    } catch (err) {
      this.connecting = false;
      this.failAndReconnect(err instanceof Error ? err.message : "connect failed");
    }
  }
  private resubscribeAll() {
    const symbols = [...this.symbolRefs.keys()];
    for (let i = 0; i < symbols.length; i += MAX_CODES_PER_SUBSCRIBE) {
      this.sendSubscribe(["SP", "BA"], symbols.slice(i, i + MAX_CODES_PER_SUBSCRIBE));
    }
    this.sendSubscribe(["MI"], CORE_MI_IDS);
    this.miSubscribed = true;
  }
  private sendSubscribe(types: string[], codes: string[]) {
    if (!this.ws || this.state !== "open" || !codes.length) return;
    for (const name of types) {
      try {
        this.ws.send(JSON.stringify({ type: "registConsumer", data: { sequence: 0, params: { name, codes } } }));
      } catch (e) {
        this.lastError = e instanceof Error ? e.message : "subscribe send failed";
      }
    }
  }
  private handleMessage(raw: string) {
    if (!raw || raw === "ping" || raw === "pong") return;
    let obj: { type?: string; data?: unknown };
    try { obj = JSON.parse(raw) as { type?: string; data?: unknown }; } catch { return; }
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
    const symbol = String(arr[3] ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!symbol) return;
    const price = num(arr[11]) ?? num(arr[10]);
    if (price == null || price <= 0) return;
    const q: VndirectLiveQuote = {
      symbol, price, volume: Math.max(0, num(arr[12]) ?? 0), value: Math.max(0, num(arr[18]) ?? 0),
      open: num(arr[9]), high: num(arr[13]), low: num(arr[14]), matchQtty: num(arr[12]),
      eventTime: Date.now(), source: "SP",
    };
    this.quotes.set(symbol, q);
    eventBus.emit(`vndirect:quote:${symbol}`, { symbol, price: q.price, volume: q.volume, value: q.value, eventTime: q.eventTime, ts: q.eventTime });
  }
  private onBidAsk(arr: string[]) {
    if (arr.length < 16) return;
    const symbol = String(arr[1] ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!symbol) return;
    const price = num(arr[15]);
    if (price == null || price <= 0) return;
    const prev = this.quotes.get(symbol);
    const q: VndirectLiveQuote = {
      symbol, price, volume: Math.max(0, num(arr[14]) ?? 0), value: Math.max(0, num(arr[17]) ?? 0),
      open: prev?.open ?? null, high: prev?.high ?? null, low: prev?.low ?? null, matchQtty: num(arr[16]),
      eventTime: Date.now(), source: "BA",
    };
    this.quotes.set(symbol, q);
    eventBus.emit(`vndirect:quote:${symbol}`, { symbol, price: q.price, volume: q.volume, value: q.value, eventTime: q.eventTime, ts: q.eventTime });
  }
  private onMarketInfo(arr: string[]) {
    if (arr.length < 13) return;
    const marketId = String(arr[0] ?? "").trim();
    const code = (MI_CODE_MAP[marketId] ?? String(arr[11] ?? "").toUpperCase()).replace(/[^A-Z0-9]/g, "");
    if (!code) return;
    const value = num(arr[12]) ?? num(arr[7]);
    if (value == null || value <= 0) return;
    const idx: VndirectLiveIndex = {
      code, value, change: num(arr[8]), volume: num(arr[2]) ?? num(arr[16]), valueTraded: num(arr[3]),
      advances: num(arr[4]), declines: num(arr[5]), unchanged: num(arr[6]), eventTime: Date.now(),
    };
    this.indices.set(code, idx);
    eventBus.emit(`vndirect:index:${code}`, { code, symbol: code, price: idx.value, value: idx.value, volume: idx.volume ?? 0, eventTime: idx.eventTime, ts: idx.eventTime });
  }
  private checkLiveness() {
    if (!this.enabled()) return;
    if (this.state === "open") {
      const last = this.lastMessageAt ?? this.connectedAt ?? 0;
      const inSession = isVnSessionWindow();
      const silentLimit = inSession ? SILENT_MS_SESSION : SILENT_MS_OFFHOURS;
      const limit = !inSession && this.symbolRefs.size > 0 ? Math.min(silentLimit, SILENT_MS) : silentLimit;
      if (Date.now() - last > limit) this.failAndReconnect("silent timeout");
      return;
    }
    if (this.state === "closed" && !this.connecting && !this.timer && this.started) {
      this.scheduleReconnect(computeBackoffMs("network", this.reconnectAttempts || 1, isVnSessionWindow()));
    }
  }
  private reconnectUrgent(_why: string) {
    if (!this.enabled() || this.connecting || this.state === "open") return;
    this.scheduleReconnect(URGENT_MS + Math.floor(Math.random() * 40), true);
  }
  private scheduleReconnect(delayMs: number, _urgent = false) {
    if (!this.enabled()) { this.clearRetryTimer(); this.state = "disabled"; return; }
    const target = Date.now() + delayMs;
    if (this.timer && this.nextRetryAt != null) {
      if (this.nextRetryAt <= target) return;
      this.clearRetryTimer();
    }
    this.state = "retrying";
    this.nextRetryAt = target;
    this.timer = setTimeout(() => { this.timer = null; this.nextRetryAt = null; void this.connect(); }, Math.max(0, delayMs));
    this.timer.unref?.();
  }
  private failAndReconnect(reason: string) {
    this.connecting = false;
    const kind = classifyFail(reason);
    this.lastFailKind = kind;
    this.lastError = reason.slice(0, 240);
    this.state = "closed";
    recordFailure(PROVIDER, this.lastError, "realtime");
    this.hardClose();
    if (!this.enabled()) { this.clearRetryTimer(); this.state = "disabled"; return; }
    this.reconnectAttempts += 1;
    if (this.reconnectAttempts % 2 === 0) rotateWsHost();
    if (this.reconnectAttempts > RETRY_BUDGET) {
      const cooldown = isVnSessionWindow() ? BUDGET_COOLDOWN_MS : BUDGET_COOLDOWN_MS * 2;
      this.clearRetryTimer();
      this.state = "retrying";
      this.nextRetryAt = Date.now() + cooldown;
      this.timer = setTimeout(() => {
        this.reconnectAttempts = 0; this.timer = null; this.nextRetryAt = null; void this.connect();
      }, cooldown);
      this.timer.unref?.();
      return;
    }
    this.scheduleReconnect(computeBackoffMs(kind, this.reconnectAttempts, isVnSessionWindow()));
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
