/**
 * CHART LIVE MANAGER (client)
 *
 * Transport:
 *   crypto  → native WebSocket → Binance kline (lowest latency)
 *   stock   → SSE (server-side VNDirect WebSocket) + soft REST fallback if delayed
 *   forex   → REST live-quote poll (no public browser WS)
 *
 * Guards: OHLC sanitize, monotonic time, no dual-source race on last bar.
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

  start(symbol: string, timeframe: string, handlers: LiveHandlers, assetType = "crypto"): number {
    this.stop();
    const tk = ++this.token;
    handlers.onLiveState({ state: "connecting", ageMs: null });

    if (assetType === "crypto" && BINANCE_KLINE_TF.has(timeframe)) {
      this.startBinanceWs(symbol, timeframe, handlers, tk);
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

  private startBinanceWs(symbol: string, timeframe: string, handlers: LiveHandlers, tk: number) {
    const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!sym) return;
    const stream = `${sym.toLowerCase()}@kline_${timeframe}`;
    const url = `wss://stream.binance.com:9443/ws/${stream}`;

    try {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        if (tk !== this.token) return;
        this.wsAttempts = 0;
        if (this.everConnected) handlers.onResyncNeeded();
        this.everConnected = true;
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
        if (tk !== this.token) return;
        this.ws = null;
        handlers.onLiveState({ state: "reconnecting", ageMs: null });
        this.wsAttempts += 1;
        const delay = Math.min(15_000, 400 * 2 ** Math.min(this.wsAttempts, 5)) + Math.random() * 200;
        this.wsRetryTimer = setTimeout(() => {
          if (tk === this.token) this.startBinanceWs(symbol, timeframe, handlers, tk);
        }, delay);
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

  /** Only fires when primary stream is stale — prevents last-bar double-write races. */
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
    try {
      this.ws?.close();
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
    if (this.wsRetryTimer) clearTimeout(this.wsRetryTimer);
    this.wsRetryTimer = null;
    this.everConnected = false;
    this.lastEventAt = 0;
    this.lastPrice = null;
    this.lastEmitSec = 0;
    this.wsAttempts = 0;
  }
}
