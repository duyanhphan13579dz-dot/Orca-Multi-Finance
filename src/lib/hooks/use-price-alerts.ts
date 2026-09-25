"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  activeSymbols,
  loadAlerts,
  markTriggered,
  shouldTrigger,
  type PriceAlert,
} from "@/lib/alerts-store";
import { isValidWebhookUrl, loadWebhookConfig } from "@/lib/webhook-store";

type PermissionState = NotificationPermission | "unsupported";

async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    return reg;
  } catch {
    return null;
  }
}

export async function requestNotificationPermission(): Promise<PermissionState> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") {
    await ensureServiceWorker();
    return "granted";
  }
  if (Notification.permission === "denied") return "denied";
  const p = await Notification.requestPermission();
  if (p === "granted") await ensureServiceWorker();
  return p;
}

function alertTitle(alert: PriceAlert): string {
  const kind = alert.kind ?? "price";
  if (kind === "ceiling") return `Chạm trần · ${alert.symbol}`;
  if (kind === "floor") return `Chạm sàn · ${alert.symbol}`;
  return `Cảnh báo ${alert.symbol}`;
}

function alertBody(alert: PriceAlert, price: number): string {
  const kind = alert.kind ?? "price";
  if (kind === "ceiling") {
    return [`Giá ${price.toLocaleString("vi-VN")} chạm trần phiên`, alert.reason ? `Lý do: ${alert.reason}` : null]
      .filter(Boolean)
      .join("\n");
  }
  if (kind === "floor") {
    return [`Giá ${price.toLocaleString("vi-VN")} chạm sàn phiên`, alert.reason ? `Lý do: ${alert.reason}` : null]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `Giá ${price.toLocaleString("vi-VN")} đã chạm mức ${alert.targetPrice.toLocaleString("vi-VN")}`,
    alert.reason ? `Lý do: ${alert.reason}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

async function showAlertNotification(alert: PriceAlert, price: number) {
  const title = alertTitle(alert);
  const body = alertBody(alert, price);

  const opts: NotificationOptions = {
    body,
    tag: `orca-alert-${alert.id}`,
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    data: { url: `/stocks/${encodeURIComponent(alert.symbol)}`, alertId: alert.id },
    requireInteraction: true,
  };

  try {
    const reg = await ensureServiceWorker();
    if (reg?.showNotification) {
      await reg.showNotification(title, opts);
      return;
    }
  } catch {
    /* fallback */
  }
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, opts);
  }
}

/** POST alert to configured webhook via server proxy (Discord / Slack / generic). */
export async function dispatchAlertWebhook(alert: PriceAlert, price: number): Promise<boolean> {
  const cfg = loadWebhookConfig();
  if (!cfg.enabled || !cfg.url || !isValidWebhookUrl(cfg.url)) return false;

  const kind = alert.kind ?? "price";
  const color = kind === "ceiling" ? 0xa78bfa : kind === "floor" ? 0x38bdf8 : 0x22c55e;

  try {
    const res = await fetch("/api/v1/alerts/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: cfg.url,
        provider: cfg.provider,
        secret: cfg.secret || undefined,
        title: alertTitle(alert),
        body: alertBody(alert, price),
        symbol: alert.symbol,
        price,
        targetPrice: alert.targetPrice || undefined,
        direction: kind === "price" ? alert.direction : kind,
        reason: alert.reason || undefined,
        color,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Giám sát cảnh báo toàn app: poll giá các mã active,
 * kích hoạt + push notification + webhook khi chạm mức.
 */
export function usePriceAlertMonitor(pollMs = 15_000) {
  const prevPrices = useRef<Record<string, number>>( {} );
  const firing = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      if (cancelled || document.visibilityState === "hidden") return;
      const alerts = loadAlerts().filter((a) => a.status === "active");
      const symbols = activeSymbols(alerts);
      if (symbols.length === 0) return;

      try {
        const qs = symbols.slice(0, 40).join(",");
        const res = await fetch(`/api/v1/stocks?symbols=${encodeURIComponent(qs)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as {
          data?: {
            quotes?: {
              symbol: string;
              price: number;
              ceilingPrice?: number | null;
              floorPrice?: number | null;
            }[];
          };
        };
        const quotes = json.data?.quotes ?? [];
        for (const q of quotes) {
          if (!q?.symbol || !Number.isFinite(q.price)) continue;
          const prev = prevPrices.current[q.symbol] ?? null;
          const matched = alerts.filter(
            (a) =>
              a.symbol === q.symbol &&
              shouldTrigger(a, q.price, prev, {
                ceiling: q.ceilingPrice,
                floor: q.floorPrice,
              }),
          );
          prevPrices.current[q.symbol] = q.price;
          for (const a of matched) {
            if (firing.current.has(a.id)) continue;
            firing.current.add(a.id);
            markTriggered(a.id, q.price);
            await showAlertNotification(a, q.price);
            void dispatchAlertWebhook(a, q.price);
          }
        }
      } catch {
        /* network */
      }
    };

    void tick();
    timer = window.setInterval(() => void tick(), pollMs);
    const onVis = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [pollMs]);
}

export function usePriceAlertsList() {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const refresh = useCallback(() => setAlerts(loadAlerts()), []);

  useEffect(() => {
    refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "orca.price-alerts.v1") refresh();
    };
    const onCustom = () => refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener("orca-alerts-changed", onCustom as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("orca-alerts-changed", onCustom as EventListener);
    };
  }, [refresh]);

  return { alerts, refresh };
}

export function useNotificationPermission() {
  const [permission, setPermission] = useState<PermissionState>("default");

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission);
  }, []);

  const request = useCallback(async () => {
    const p = await requestNotificationPermission();
    setPermission(p);
    return p;
  }, []);

  return { permission, request };
}
