/**
 * CHART SUBSCRIPTION MANAGER (client) — EventSource + stock/forex live-quote poll.
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
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastPrice: number | null = null;

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
        const payload = JSON.parse((e as MessageEvent).data as string) as { candle?: ChartCandle };
        if (payload.candle) {
          this.lastEventAt = Date.now();
          this.lastPrice = payload.candle.close;
          handlers.onCandle(payload.candle, closed);
        }
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
          if (tk === this.token) this.start(symbol, timeframe, handlers, assetType);
        }, 3_000 + Math.random() * 2_000);
      }
    };

    if (assetType === "stock" || assetType === "forex") {
      const poll = async () => {
        if (tk !== this.token) return;
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
          this.lastPrice = d.price;
          this.lastEventAt = Date.now();
          const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: assetType === "forex" ? "UTC" : "Asia/Ho_Chi_Minh",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).formatToParts(new Date(d.ts ?? Date.now()));
          const get = (ty: string) => parts.find((p) => p.type === ty)?.value ?? "00";
          const dayKey = `${get("year")}-${get("month")}-${get("day")}`;
          const TF_MS_CLIENT: Record<string, number> = {
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
          const tfMs = TF_MS_CLIENT[timeframe] ?? 0;
          const bucket =
            timeframe === "1d" || timeframe === "1w" || timeframe === "1M" || timeframe === "12M"
              ? assetType === "forex"
                ? Date.parse(`${dayKey}T00:00:00Z`)
                : Date.parse(`${dayKey}T15:00:00+07:00`)
              : tfMs
                ? Math.floor((d.ts ?? Date.now()) / tfMs) * tfMs
                : Date.parse(`${dayKey}T00:00:00Z`);
          const open = d.open && d.open > 0 ? d.open : d.price;
          const high = Math.max(d.high && d.high > 0 ? d.high : d.price, d.price);
          const low = Math.min(d.low && d.low > 0 ? d.low : d.price, d.price);
          handlers.onCandle(
            { time: bucket, open, high, low, close: d.price, volume: d.volume ?? 0 },
            false,
          );
        } catch {
          /* ignore */
        }
      };
      void poll();
      this.pollTimer = setInterval(poll, assetType === "forex" ? 5_000 : 2_500);
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

  stop() {
    this.token++;
    this.es?.close();
    this.es = null;
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.everConnected = false;
    this.lastEventAt = 0;
    this.lastPrice = null;
  }
}
