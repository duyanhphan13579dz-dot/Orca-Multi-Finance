/**
 * CHART LIVE MANAGER (client)
 *
 * Transport:
 *   crypto  → native WebSocket → Binance kline (lowest latency)
 *   stock   → SSE (server-side VNDirect WebSocket) + soft REST fallback if delayed
 *   forex   → SSE chart stream (Biquote poll) + soft live-quote 2s
 *
 * Reconnect: full-jitter fast hops, host rotation, single-flight timer,
 * visibility/online urgent resume, handshake timeout, onerror+onclose de-duped.
 */

import { TF_MS } from "@/lib/chart-const";

export type LiveCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type LiveState = {
  state: "connecting" | "live" | "delayed" | "offline";
  ageMs: number | null;
};

export type LiveHandlers = {
  onCandle: (c: LiveCandle, closed: boolean) => void;
  onLiveState: (s: LiveState) => void;
};

const BINANCE_KLINE_TF = new Set([
  "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "1w", "1M",
]);

function emitCandle(
  handlers: LiveHandlers,
  candle: LiveCandle,
  closed: boolean,
  state: { lastEmitSec: number; lastPrice: number | null; lastEventAt: number | null },
) {
  const sec = Math.floor(Date.now() / 1000);
  if (!closed && state.lastEmitSec === sec && state.lastPrice != null && Math.abs(candle.close - state.lastPrice) < 1e-12) {
    return { lastEmitSec: state.lastEmitSec, lastPrice: state.lastPrice, lastEventAt: Date.now() };
  }
  handlers.onCandle(candle, closed);
  return { lastEmitSec: sec, lastPrice: candle.close, lastEventAt: Date.now() };
}

export class ChartLiveManager {
  private token = 0;
  private es: EventSource | null = null;
  private ws: WebSocket | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private wsRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPrice: number | null = null;
  private lastEmitSec = 0;
  private lastEventAt: number | null = null;
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

    if (assetType === "stock" || assetType === "forex" || assetType === "commodity") {
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
    }, 2_000);

    return tk;
  }

  private clearWsRetry() {
    if (this.wsRetryTimer) clearTimeout(this.wsRetryTimer);
    this.wsRetryTimer = null;
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
    const delay = urgent ? 200 + Math.random() * 400 : Math.min(8_000, 400 * 2 ** Math.min(this.wsAttempts, 4));
    this.wsRetryTimer = setTimeout(() => {
      if (tk !== this.token) return;
      this.wsAttempts++;
      this.startBinanceWs(symbol, timeframe, handlers, tk);
    }, delay);
  }

  private startBinanceWs(symbol: string, timeframe: string, handlers: LiveHandlers, tk: number) {
    try {
      if (this.ws) {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.ws.close();
        this.ws = null;
      }
      const stream = `${symbol.toLowerCase()}@kline_${timeframe}`;
      const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${stream}`);
      this.ws = ws;
      ws.onmessage = (ev) => {
        if (tk !== this.token) return;
        try {
          const msg = JSON.parse(String(ev.data));
          const k = msg.k;
          if (!k) return;
          const next = emitCandle(
            handlers,
            {
              time: Math.floor(k.t / 1000) * 1000,
              open: Number(k.o),
              high: Number(k.h),
              low: Number(k.l),
              close: Number(k.c),
              volume: Number(k.v),
            },
            Boolean(k.x),
            { lastEmitSec: this.lastEmitSec, lastPrice: this.lastPrice, lastEventAt: this.lastEventAt },
          );
          this.lastEmitSec = next.lastEmitSec;
          this.lastPrice = next.lastPrice;
          this.lastEventAt = next.lastEventAt;
          this.wsAttempts = 0;
        } catch {
          /* ignore */
        }
      };
      ws.onerror = () => {
        if (tk === this.token) this.scheduleWsReconnect(symbol, timeframe, handlers, tk);
      };
      ws.onclose = () => {
        if (tk === this.token) this.scheduleWsReconnect(symbol, timeframe, handlers, tk);
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

    const onPayload = (raw: string) => {
      if (tk !== this.token) return;
      try {
        const p = JSON.parse(raw) as {
          candle?: LiveCandle;
          closed?: boolean;
        };
        if (p.candle && p.candle.close > 0) {
          const next = emitCandle(handlers, p.candle, Boolean(p.closed), {
            lastEmitSec: this.lastEmitSec,
            lastPrice: this.lastPrice,
            lastEventAt: this.lastEventAt,
          });
          this.lastEmitSec = next.lastEmitSec;
          this.lastPrice = next.lastPrice;
          this.lastEventAt = next.lastEventAt;
        }
      } catch {
        /* ignore */
      }
    };

    es.addEventListener("chart.candle.updated", ((ev: MessageEvent) => onPayload(ev.data)) as EventListener);
    es.addEventListener("chart.candle.closed", ((ev: MessageEvent) => onPayload(ev.data)) as EventListener);
    es.addEventListener("snapshot", ((ev: MessageEvent) => onPayload(ev.data)) as EventListener);
    es.onerror = () => {
      if (tk === this.token) {
        try {
          es.close();
        } catch {
          /* */
        }
        this.es = null;
        setTimeout(() => {
          if (tk === this.token) this.startSse(symbol, timeframe, handlers, assetType, tk);
        }, 2_500);
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
      try {
        const res = await fetch(
          `/api/v1/chart/live-quote?symbol=${encodeURIComponent(symbol)}&assetType=${encodeURIComponent(assetType)}&_=${Date.now()}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const json = (await res.json()) as {
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
          timeZone: assetType === "forex" || assetType === "commodity" ? "UTC" : "Asia/Ho_Chi_Minh",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).formatToParts(new Date(d.ts ?? Date.now()));
        const get = (ty: string) => parts.find((p) => p.type === ty)?.value ?? "00";
        const dayKey = `${get("year")}-${get("month")}-${get("day")}`;
        const tfMs = TF_MS[timeframe] ?? 0;
        const bucket =
          timeframe === "1d" || timeframe === "1w" || timeframe === "1M" || timeframe === "12M"
            ? assetType === "forex" || assetType === "commodity"
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

    this.pollTimer = setInterval(
      poll,
      assetType === "forex" || assetType === "commodity" ? 2_000 : 5_000,
    );
    void poll();
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
    try {
      this.es?.close();
    } catch {
      /* */
    }
    this.es = null;
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    if (this.visHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visHandler);
    }
    this.visHandler = null;
    if (this.onlineHandler && typeof window !== "undefined") {
      window.removeEventListener("online", this.onlineHandler);
    }
    this.onlineHandler = null;
  }
}
