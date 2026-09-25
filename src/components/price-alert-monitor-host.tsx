"use client";

import { useEffect, useState } from "react";
import { useSettings } from "@/lib/settings";
import { usePriceAlertMonitor } from "@/lib/hooks/use-price-alerts";
import { loadWebhookConfig } from "@/lib/webhook-store";

/**
 * Mount once in AppShell.
 * Poll only when priceAlerts setting is on.
 * Interval from webhook-store.pollMs (default 5s), clamped 3–30s.
 */
export function PriceAlertMonitorHost() {
  const { settings } = useSettings();
  const enabled = settings.notifications.priceAlerts;
  const [pollMs, setPollMs] = useState(5_000);

  useEffect(() => {
    const read = () => {
      const cfg = loadWebhookConfig();
      const ms = cfg.pollMs >= 3_000 && cfg.pollMs <= 30_000 ? cfg.pollMs : 5_000;
      setPollMs(ms);
    };
    read();
    window.addEventListener("orca-webhook-changed", read as EventListener);
    return () => window.removeEventListener("orca-webhook-changed", read as EventListener);
  }, []);

  usePriceAlertMonitor(enabled ? pollMs : 0);
  return null;
}
