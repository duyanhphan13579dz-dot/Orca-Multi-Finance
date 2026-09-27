"use client";

import { useEffect, useRef } from "react";
import { requestNotificationPermission } from "@/lib/hooks/use-price-alerts";

type PatternEvent = {
  id: string;
  symbol: string;
  name: string | null;
  price: number | null;
  changePercent: number | null;
  pattern: {
    name: string;
    nameVi: string;
    type: "bullish" | "bearish" | "neutral";
    reliability: string;
    score: number;
    description: string;
    volumeConfirmed: boolean;
  };
  firedAt: number;
};

/**
 * Polls server-side reversal pattern alerts (filled by cron) and shows
 * browser push notifications — same channel as price alerts.
 */
export function PatternAlertMonitorHost() {
  const seenRef = useRef<Set<string>>(new Set());
  const primedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function ensurePerm() {
      try {
        await requestNotificationPermission();
      } catch {
        /* ignore */
      }
    }

    async function showNotif(ev: PatternEvent) {
      if (typeof window === "undefined" || !("Notification" in window)) return;
      if (Notification.permission !== "granted") return;

      const isBull = ev.pattern.type === "bullish";
      const title = `Cảnh báo nến · ${ev.symbol}`;
      const priceStr =
        ev.price != null ? ev.price.toLocaleString("vi-VN") : "—";
      const chg =
        ev.changePercent != null
          ? `${ev.changePercent > 0 ? "+" : ""}${ev.changePercent.toFixed(2)}%`
          : "";
      const body = [
        `${isBull ? "Đảo chiều tăng" : "Đảo chiều giảm"} — ${ev.pattern.nameVi}`,
        `Giá ${priceStr}${chg ? ` (${chg})` : ""} · điểm ${ev.pattern.score}`,
        ev.pattern.volumeConfirmed ? "Volume xác nhận" : null,
      ]
        .filter(Boolean)
        .join("\n");

      const opts: NotificationOptions = {
        body,
        tag: "orca-pattern-" + ev.id,
        icon: "/favicon.ico",
        badge: "/favicon.ico",
        data: { url: "/stocks/" + encodeURIComponent(ev.symbol), alertId: ev.id },
        requireInteraction: true,
      };

      try {
        if ("serviceWorker" in navigator) {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg?.showNotification) {
            await reg.showNotification(title, opts);
            return;
          }
        }
      } catch {
        /* fallback */
      }
      try {
        new Notification(title, opts);
      } catch {
        /* ignore */
      }
    }

    async function tick() {
      if (cancelled) return;
      try {
        const res = await fetch("/api/v1/screener/candlestick?recent=1&limit=15", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as {
          data?: { events?: PatternEvent[] };
          events?: PatternEvent[];
        };
        const events = json.data?.events ?? json.events ?? [];
        if (!Array.isArray(events)) return;

        if (!primedRef.current) {
          for (const ev of events) seenRef.current.add(ev.id);
          primedRef.current = true;
          return;
        }

        for (const ev of events) {
          if (seenRef.current.has(ev.id)) continue;
          if (Date.now() - (ev.firedAt || 0) > 2 * 60 * 60 * 1000) {
            seenRef.current.add(ev.id);
            continue;
          }
          seenRef.current.add(ev.id);
          await showNotif(ev);
        }
      } catch {
        /* network ok to fail silently */
      }
    }

    void ensurePerm();
    void tick();
    timer = setInterval(() => void tick(), 90_000);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  return null;
}
