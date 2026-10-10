"use client";

import { useEffect, useRef, useState } from "react";

export type StreamQuote = {
  symbol: string;
  price: number;
  changePercent: number | null;
  ceiling: number | null;
  floor: number | null;
  volume: number | null;
  ts: number;
  source: string;
};

export type MarketStreamStatus = "idle" | "connecting" | "open" | "error" | "closed";

/** Client SSE consumer for /api/v1/market/stream with auto-reconnect. */
export function useMarketStream(
  symbols: string[],
  opts?: { enabled?: boolean; asset?: "stock" | "crypto" | "auto" },
) {
  const enabled = opts?.enabled !== false;
  const asset = opts?.asset ?? "auto";
  const [quotes, setQuotes] = useState<Record<string, StreamQuote>>({});
  const [status, setStatus] = useState<MarketStreamStatus>("idle");
  const [lastError, setLastError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const key = symbols
    .map((s) => s.toUpperCase())
    .filter(Boolean)
    .sort()
    .join(",");

  const isStreamActive = Boolean(enabled && key);
  const [prevStreamActive, setPrevStreamActive] = useState(isStreamActive);
  if (prevStreamActive !== isStreamActive) {
    setPrevStreamActive(isStreamActive);
    if (!isStreamActive && status !== "idle") {
      setStatus("idle");
    }
  }

  useEffect(() => {
    if (!enabled || !key) {
      esRef.current?.close();
      esRef.current = null;
      return;
    }

    let cancelled = false;
    let retry = 0;
    let timer: number | undefined;
    let pollTimer: number | undefined;
    let sseFailures = 0;

    // Fallback khi SSE không bền (Cloudflare Workers): poll JSON mỗi 3s.
    const startPolling = () => {
      if (cancelled || pollTimer) return;
      const pollOnce = async () => {
        try {
          const r = await fetch(
            `/api/v1/market/stream?mode=poll&symbols=${encodeURIComponent(key)}&asset=${asset}`,
            { cache: "no-store" },
          );
          if (!r.ok) throw new Error(String(r.status));
          const j = (await r.json()) as { data?: { quotes?: Record<string, StreamQuote> } };
          if (cancelled) return;
          setQuotes((prev) => ({ ...prev, ...(j.data?.quotes ?? {}) }));
          setStatus("open");
          setLastError(null);
        } catch {
          if (!cancelled) {
            setStatus("error");
            setLastError("poll failed");
          }
        }
      };
      void pollOnce();
      pollTimer = window.setInterval(() => void pollOnce(), 3_000);
    };

    const connect = () => {
      if (cancelled) return;
      setStatus("connecting");
      const url = `/api/v1/market/stream?symbols=${encodeURIComponent(key)}&asset=${asset}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.addEventListener("hello", () => {
        if (cancelled) return;
        setStatus("open");
        setLastError(null);
        retry = 0;
      });

      es.addEventListener("quote", (ev) => {
        if (cancelled) return;
        try {
          const q = JSON.parse((ev as MessageEvent).data) as StreamQuote;
          if (!q?.symbol || !Number.isFinite(q.price)) return;
          setQuotes((prev) => ({ ...prev, [q.symbol]: q }));
        } catch {
          /* */
        }
      });

      es.onerror = () => {
        if (cancelled) return;
        if (++sseFailures >= 2) {
          es.close();
          esRef.current = null;
          startPolling();
          return;
        }
        setStatus("error");
        setLastError("stream disconnected");
        es.close();
        esRef.current = null;
        const delay = Math.min(15_000, 1_000 * Math.pow(2, retry++));
        timer = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      if (pollTimer) window.clearInterval(pollTimer);
      esRef.current?.close();
      esRef.current = null;
      setStatus("closed");
    };
  }, [enabled, key, asset]);

  return { quotes, status, lastError };
}
