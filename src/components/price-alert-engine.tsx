"use client";

import { useEffect, useMemo, useState } from "react";
import { useSettings } from "@/lib/settings";
import {
  dispatchAlertWebhook,
  usePriceAlertMonitor,
} from "@/lib/hooks/use-price-alerts";
import { loadWebhookConfig } from "@/lib/webhook-store";
import { useMarketStream } from "@/lib/hooks/use-market-stream";
import {
  activeSymbols,
  loadAlerts,
  markTriggered,
  shouldTrigger,
} from "@/lib/alerts-store";

/** Global SSE + REST monitor for price alerts and portfolio SL/TP. */
export function PriceAlertEngine() {
  const { settings } = useSettings();
  const enabled = settings.notifications?.priceAlerts !== false;
  const [pollMs, setPollMs] = useState(5_000);
  const [symbols, setSymbols] = useState<string[]>([]);

  useEffect(() => {
    const sync = () => {
      const cfg = loadWebhookConfig();
      setPollMs(cfg.pollMs && cfg.pollMs >= 3000 ? cfg.pollMs : 5_000);
    };
    sync();
    window.addEventListener("orca-webhook-changed", sync as EventListener);
    return () => window.removeEventListener("orca-webhook-changed", sync as EventListener);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setSymbols([]);
      return;
    }
    const refresh = () => {
      const alerts = loadAlerts().filter((a) => a.status === "active");
      const syms = new Set(activeSymbols(alerts));
      try {
        const trades = JSON.parse(localStorage.getItem("orca.journal.v1") ?? "[]") as {
          assetType?: string;
          symbol: string;
          exit: number | null;
        }[];
        for (const t of trades) {
          if ((t.assetType ?? "stock") === "stock" && t.exit == null && t.symbol) {
            syms.add(String(t.symbol).toUpperCase());
          }
        }
      } catch {
        /* */
      }
      setSymbols([...syms].slice(0, 40));
    };
    refresh();
    const t = window.setInterval(refresh, 15_000);
    window.addEventListener("orca-alerts-changed", refresh as EventListener);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("orca-alerts-changed", refresh as EventListener);
    };
  }, [enabled]);

  const { quotes, status } = useMarketStream(symbols, {
    enabled: enabled && symbols.length > 0,
  });

  const prevRef = useMemo(() => ({ current: {} as Record<string, number> }), []);
  const firingRef = useMemo(() => ({ current: new Set<string>() }), []);

  useEffect(() => {
    if (!enabled) return;
    const alerts = loadAlerts().filter((a) => a.status === "active");
    for (const [sym, q] of Object.entries(quotes)) {
      if (!q?.price) continue;
      const prev = prevRef.current[sym] ?? null;
      const matched = alerts.filter(
        (a) =>
          a.symbol === sym &&
          shouldTrigger(a, q.price, prev, { ceiling: q.ceiling, floor: q.floor }),
      );
      prevRef.current[sym] = q.price;
      for (const a of matched) {
        if (firingRef.current.has(a.id)) continue;
        firingRef.current.add(a.id);
        markTriggered(a.id, q.price);
        void dispatchAlertWebhook(a, q.price);
        try {
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification(
              a.kind === "ceiling"
                ? "Cham tran · " + a.symbol
                : a.kind === "floor"
                  ? "Cham san · " + a.symbol
                  : "Canh bao " + a.symbol,
              {
                body: "Gia " + q.price.toLocaleString("vi-VN") + " · " + (q.source || "live"),
                tag: "orca-alert-" + a.id,
              },
            );
          }
        } catch {
          /* */
        }
      }
    }
  }, [quotes, enabled, prevRef, firingRef]);

  // REST backup: faster when SSE down, slower when SSE open
  usePriceAlertMonitor(enabled ? (status === "open" ? Math.max(pollMs, 20_000) : pollMs) : 0);

  return null;
}
