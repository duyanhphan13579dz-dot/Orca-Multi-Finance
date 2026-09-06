/**
 * CHART SUBSCRIPTION MANAGER (client) — one EventSource per (symbol, tf),
 * version tokens to defeat races on rapid timeframe switching, automatic
 * reconnect with gap resync (history refetch after connection restore).
 */
import type { ChartCandle } from "@/lib/chart-const";
import type { LiveState } from "./theme";

export interface LiveHandlers {
  onCandle: (c: ChartCandle, closed: boolean) => void;
  onResyncNeeded: () => void;
  onLiveState: (s: LiveState) => void;
}

export class ChartLiveManager {
  private es: EventSource | null = null;
  private token = 0;
  private everConnected = false;
  private lastEventAt = 0;
  private interval: ReturnType<typeof setInterval> | null = null;

  /** start a new live subscription; returns token (stale responses must check) */
  start(symbol: string, timeframe: string, handlers: LiveHandlers, assetType = "crypto"): number {
    this.stop();
    const tk = ++this.token;
    handlers.onLiveState({ state: "connecting", ageMs: null });

    const es = new EventSource(
      `/api/v1/chart/stream?symbol=${encodeURIComponent(symbol)}&assetType=${encodeURIComponent(assetType)}&timeframe=${encodeURIComponent(timeframe)}&_=${Date.now()}`,
    );
    this.es = es;

    const candleHandler = (e: Event, closed: boolean) => {
      if (tk !== this.token) return;
      try {
        const payload = JSON.parse((e as MessageEvent).data as string) as { candle: ChartCandle };
        if (payload.candle) {
          this.lastEventAt = Date.now();
          handlers.onCandle(payload.candle, closed);
        }
      } catch {
        /* malformed event — drop */
      }
    };
    es.addEventListener("chart.candle.updated", (e) => candleHandler(e, false));
    es.addEventListener("snapshot", (e) => candleHandler(e, false));
    es.addEventListener("chart.candle.closed", (e) => candleHandler(e, true));

    es.onopen = () => {
      if (tk !== this.token) return;
      if (this.everConnected) {
        handlers.onResyncNeeded();
      }
      this.everConnected = true;
      handlers.onLiveState({ state: "connecting", ageMs: null });
    };
    es.onerror = () => {
      if (tk !== this.token) return;
      handlers.onLiveState({ state: "reconnecting", ageMs: null });
      es.close();
      if (tk === this.token) {
        setTimeout(() => {
          if (tk === this.token) this.start(symbol, timeframe, handlers, assetType);
        }, 3_000 + Math.random() * 2_000);
      }
    };

    this.interval = setInterval(() => {
      if (tk !== this.token) return;
      const age = this.lastEventAt ? Date.now() - this.lastEventAt : null;
      handlers.onLiveState(
        age == null
          ? { state: this.lastEventAt ? "live" : "connecting", ageMs: null }
          : age < 6_000
            ? { state: "live", ageMs: age }
            : { state: "delayed", ageMs: age },
      );
    }, 1_000);
    return tk;
  }

  stop() {
    this.token++;
    this.es?.close();
    this.es = null;
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.everConnected = false;
    this.lastEventAt = 0;
  }
}
