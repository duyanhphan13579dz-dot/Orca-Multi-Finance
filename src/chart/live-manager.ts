/**
 * CHART LIVE MANAGER (client)
 *
 * Transport:
 *   crypto  → native WebSocket → Binance kline (lowest latency)
 *   stock   → SSE (server-side VNDirect WebSocket) + soft REST fallback if delayed
 *   forex   → REST live-quote poll (no public browser WS)
 *
 * Reconnect: full-jitter fast hops, host rotation, single-flight timer,
 * visibility/online urgent resume, handshake timeout, onerror+onclose de-duped.
 */
import type { ChartCandle } from "@/lib/chart-const";
import type { LiveState } from "./theme";

export interface LiveHandlers {
  onCandle: (c: ChartCandle, closed: boolean) => void;
  onResyncNeeded: () => void;
  onLiveState: (s: LiveState) => void;
}

const BINANCE_KLINE_TF = new Set([
  "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M",
]);

const TF_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
  "1w": 604_800_000,
  "1M": 2_592_000_000,
  "12M": 31_536_000_000,
};

function emitCandle(
  handlers: LiveHandlers,
  c: ChartCandle,
  closed: boolean,
  state: { lastEmitSec: number; lastPrice: number | null; lastEventAt: number },
): { lastEmitSec: number; lastPrice: number | null; lastEventAt: number } {
  const close = Number(c.close);
  const time = Number(c.time);
  if (!Number.isFinite(close) || close <= 0 || !Number.isFinite(time) || time <= 0) return state;
  const open = Number(c.open);
  const high = Number(c.high);
  const low = Number(c.low);
  if (![open, high, low].every((v) => Number.isFinite(v) && v > 0)) return state;
  const sec = Math.floor(time > 1e11 ? time / 1000 : time);
  if (sec < state.lastEmitSec) return state;
  const hi = Math.max(open, high, low, close);
  const lo = Math.min(open, high, low, close);
  handlers.onCandle(
    {
      time,
      open,
      high: hi,
      low: lo,
      close,
      volume: Math.max(0, Number(c.volume) || 0),
    },
    closed,
  );
  return {
    lastEmitSec: sec,
    lastPrice: close,
    lastEventAt: Date.now(),
  };
}

export class ChartLiveManager {
  private es: EventSource | null = null;
  private ws: WebSocket | null = null;
  private token = 0;
  private everConnected = false;
  private lastEventAt = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private wsRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPrice: number | null = null;
  private lastEmitSec = 0;
  private wsAttempts = 0;
  private visHandler: (() => void) | null = null;
  private onlineHandler: (() => void) | null = null;

  start(symbol: string, timeframe: string, handlers: LiveHandlers, assetType = "crypto"): number {
    this.stop();
    const tk = ++this.token;
    handlers.onLiveState({ state: "connecting", ageMs: null });

    if (assetType === "crypto" && BINANCE_KLINE_TF.has(timeframe)) {
      this.startBinanceWs(symbol, timeframe, handlers, tk);
      if (typeof document !== "undefined") {
        const onVis = () => {
          if (tk !== this.token) return;
          if (document.visibilityState !== "visible") return;
          if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
          this.scheduleWsReconnect(symbol, timeframe, handlers, tk, true);
        };
        document.addEventListener("visibilitychange", onVis);
        this.visHandler = onVis;
      }
      if (typeof window !== "undefined") {
        const onOnline = () => {
          if (tk !== this.token) return;
          this.scheduleWsReconnect(symbol, timeframe, handlers, tk, true);
        };
        window.addEventListener("online", onOnline);
        this.onlineHandler = onOnline;
      }
    } else {
      this.startSse(symbol, timeframe, handlers, assetType, tk);
    }

    if (assetType === "stock" || assetType === "forex") {
      this.startSoftPoll(symbol, timeframe, handlers, assetType, tk);
    }

    this.interval = setInterval(() => {
      if (tk !== this.token) return;
      const age = this.lastEventAt ? Date.now() - this.lastEventAt : null;
      handlers.onLiveState(
        age == null
          ? { state: this.lastEventAt ? "live" : "connecting", ageMs: null }
          : age < 12_000
            ? { state: "live", ageMs: age }
            : { state: "delayed", ageMs: age },
      );
    }, 1_000);

    return tk;
  }

  private wsBackoffMs(attempt: number): number {
    const n = Math.max(1, attempt);
    if (n === 1) return 40 + Math.floor(Math.random() * 80);
    if (n === 2) return 120 + Math.floor(Math.random() * 180);
    if (n === 3) return 300 + Math.floor(Math.random() * 400);
    const ceiling = Math.min(400 * 2 ** Math.min(n - 1, 5), 12_000);
    return Math.floor(ceiling * (0.4 + Math.random() * 0.6));
  }

  private clearWsRetry() {
    if (this.wsRetryTimer) {
      clearTimeout(this.wsRetryTimer);
      this.wsRetryTimer = null;
    }
  }

  private scheduleWsReconnect(
    symbol: string,
    timeframe: string,
    handlers: LiveHandlers,
    tk: number,
    urgent = false,
  ) {
    if (tk !== this.token) return;
    this.clearWsRetry();
    this.wsAttempts += 1;
    const delay = urgent ? 30 + Math.floor(Math.random() * 50) : this.wsBackoffMs(this.wsAttempts);
    handlers.onLiveState({ state: "reconnecting", ageMs: null });
    this.wsRetryTimer = setTimeout(() => {
      this.wsRetryTimer = null;
      if (tk === this.token) this.startBinanceWs(symbol, timeframe, handlers, tk);
    }, delay);
  }

  private startBinanceWs(symbol: string, timeframe: string, handlers: LiveHandlers, tk: number) {
    const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!sym) return;
    this.clearWsRetry();

    const hosts = [
      "wss://stream.binance.com:9443/ws",
      "wss://data-stream.binance.vision/ws",
      "wss://stream.binance.com/ws",
    ];
    const host = hosts[this.wsAttempts % hosts.length]!;
    const stream = `${sym.toLowerCase()}@kline_${timeframe}`;
    const url = `${host}/${stream}`;

    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.ws.close();
      } catch {
        /* */
      }
      this.ws = null;
    }

    let closedHandled = false;
    const onFail = (urgent = false) => {
      if (closedHandled || tk !== this.token) return;
      closedHandled = true;
      this.ws = null;
      this.scheduleWsReconnect(symbol, timeframe, handlers, tk, urgent);
    };

    try {
      const ws = new WebSocket(url);
      this.ws = ws;

      const handshakeTimer = setTimeout(() => {
        if (tk !== this.token || this.ws !== ws) return;
        if (ws.readyState !== WebSocket.OPEN) {
          try {
            ws.close();
          } catch {
            onFail(true);
          }
        }
      }, 5_000);

      ws.onopen = () => {
        if (tk !== this.token) return;
        clearTimeout(handshakeTimer);
        this.wsAttempts = 0;
        if (this.everConnected) handlers.onResyncNeeded();
        this.everConnected = true;
        this.lastEventAt = Date.now();
        handlers.onLiveState({ state: "live", ageMs: 0 });
      };

      ws.onmessage = (ev) => {
        if (tk !== this.token) return;
        try {
          const msg = JSON.parse(String(ev.data)) as {
            k?: {
              t?: number;
              o?: string;
              h?: string;
              l?: string;
              c?: string;
              v?: string;
              x?: boolean;
            };
          };
          const k = msg.k;
          if (!k || k.t == null) return;
          const open = Number(k.o);
          const high = Number(k.h);
          const low = Number(k.l);
          const close = Number(k.c);
          const volume = Number(k.v) || 0;
          if (![open, high, low, close].every((v) => Number.isFinite(v) && v > 0)) return;
          const next = emitCandle(
            handlers,
            { time: k.t, open, high, low, close, volume },
            Boolean(k.x),
            {
              lastEmitSec: this.lastEmitSec,
              lastPrice: this.lastPrice,
              lastEventAt: this.lastEventAt,
            },
          );
          this.lastEmitSec = next.lastEmitSec;
          this.lastPrice = next.lastPrice;
          this.lastEventAt = next.lastEventAt;
          if (k.x) handlers.onResyncNeeded();
        } catch {
          /* drop */
        }
      };

      ws.onerror = () => {
        if (tk !== this.token) return;
        handlers.onLiveState({ state: "reconnecting", ageMs: null });
      };

      ws.onclose = () => {
        clearTimeout(handshakeTimer);
        onFail(false);
      };
    } catch {
      this.startSse(symbol, timeframe, handlers, "crypto", tk);
    }
  }

  private startSse(
    symbol: string,
    timeframe: string,
    handlers: LiveHandlers,
    assetType: string,
    tk: number,
  ) {
    const es = new EventSource(
      `/api/v1/chart/stream?symbol=${encodeURIComponent(symbol)}&assetType=${encodeURIComponent(assetType)}&timeframe=${encodeURIComponent(timeframe)}&_=${Date.now()}`,
    );
    this.es = es;

    const candleHandler = (e: Event, closed: boolean) => {
      if (tk !== this.token) return;
      try {
        const payload = JSON.parse((e as MessageEvent).data as string) as { candle?: ChartCandle };
        if (!payload.candle) return;
        const next = emitCandle(handlers, payload.candle, closed, {
          lastEmitSec: this.lastEmitSec,
          lastPrice: this.lastPrice,
          lastEventAt: this.lastEventAt,
        });
        this.lastEmitSec = next.lastEmitSec;
        this.lastPrice = next.lastPrice;
        this.lastEventAt = next.lastEventAt;
      } catch {
        /* drop */
      }
    };

    es.addEventListener("chart.candle.updated", (e) => candleHandler(e, false));
    es.addEventListener("snapshot", (e) => candleHandler(e, false));
    es.addEventListener("chart.candle.closed", (e) => candleHandler(e, true));

    es.onopen = () => {
      if (tk !== this.token) return;
      if (this.everConnected) handlers.onResyncNeeded();
      this.everConnected = true;
      handlers.onLiveState({ state: "connecting", ageMs: null });
    };
    es.onerror = () => {
      if (tk !== this.token) return;
      handlers.onLiveState({ state: "reconnecting", ageMs: null });
      es.close();
      if (tk === this.token) {
        setTimeout(() => {
          if (tk === this.token) this.startSse(symbol, timeframe, handlers, assetType, tk);
        }, 3_000 + Math.random() * 2_000);
      }
    };
  }

  private startSoftPoll(
    symbol: string,
    timeframe: string,
    handlers: LiveHandlers,
    assetType: string,
    tk: number,
  ) {
    const poll = async () => {
      if (tk !== this.token) return;
      if (this.lastEventAt && Date.now() - this.lastEventAt < 8_000) return;
      try {
        const res = await fetch(
          `/api/v1/chart/live-quote?symbol=${encodeURIComponent(symbol)}&assetType=${encodeURIComponent(assetType)}&_=${Date.now()}`,
          { cache: "no-store", headers: { Accept: "application/json" } },
        );
        const json = (await res.json()) as {
          success?: boolean;
          data?: {
            price?: number;
            open?: number | null;
            high?: number | null;
            low?: number | null;
            volume?: number;
            ts?: number;
          } | null;
        };
        const d = json?.data;
        if (!d || !d.price || d.price <= 0) return;
        if (
          this.lastPrice != null &&
          Math.abs(d.price - this.lastPrice) < 1e-9 &&
          this.lastEventAt &&
          Date.now() - this.lastEventAt < 4_000
        ) {
          this.lastEventAt = Date.now();
          return;
        }

        const parts = new Intl.DateTimeFormat("en-CA", {
          timeZone: assetType === "forex" ? "UTC" : "Asia/Ho_Chi_Minh",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).formatToParts(new Date(d.ts ?? Date.now()));
        const get = (ty: string) => parts.find((p) => p.type === ty)?.value ?? "00";
        const dayKey = `${get("year")}-${get("month")}-${get("day")}`;
        const tfMs = TF_MS[timeframe] ?? 0;
        const bucket =
          timeframe === "1d" || timeframe === "1w" || timeframe === "1M" || timeframe === "12M"
            ? assetType === "forex"
              ? Date.parse(`${dayKey}T00:00:00Z`)
              : Date.parse(`${dayKey}T15:00:00+07:00`)
            : tfMs
              ? Math.floor((d.ts ?? Date.now()) / tfMs) * tfMs
              : Date.parse(`${dayKey}T00:00:00Z`);

        const open = d.open && d.open > 0 ? d.open : d.price;
        let high = Math.max(d.high && d.high > 0 ? d.high : d.price, d.price, open);
        let low = Math.min(d.low && d.low > 0 ? d.low : d.price, d.price, open);
        high = Math.max(high, d.price);
        low = Math.min(low, d.price);
        if (low > high || low <= 0) return;

        const next = emitCandle(
          handlers,
          { time: bucket, open, high, low, close: d.price, volume: d.volume ?? 0 },
          false,
          {
            lastEmitSec: this.lastEmitSec,
            lastPrice: this.lastPrice,
            lastEventAt: this.lastEventAt,
          },
        );
        this.lastEmitSec = next.lastEmitSec;
        this.lastPrice = next.lastPrice;
        this.lastEventAt = next.lastEventAt;
      } catch {
        /* ignore */
      }
    };

    this.pollTimer = setInterval(poll, assetType === "forex" ? 6_000 : 5_000);
  }

  stop() {
    this.token++;
    this.clearWsRetry();
    try {
      if (this.ws) {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.ws.close();
      }
    } catch {
      /* */
    }
    this.ws = null;
    this.es?.close();
    this.es = null;
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    if (this.visHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visHandler);
    }
    if (this.onlineHandler && typeof window !== "undefined") {
      window.removeEventListener("online", this.onlineHandler);
    }
    this.visHandler = null;
    this.onlineHandler = null;
    this.everConnected = false;
    this.lastEventAt = 0;
    this.lastPrice = null;
    this.lastEmitSec = 0;
    this.wsAttempts = 0;
  }
}
