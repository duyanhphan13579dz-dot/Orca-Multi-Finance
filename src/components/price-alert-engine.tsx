"use client";

import { useEffect, useState } from "react";
import { useSettings } from "@/lib/settings";
import { usePriceAlertMonitor } from "@/lib/hooks/use-price-alerts";
import { loadWebhookConfig } from "@/lib/webhook-store";

/**
 * Global client-side monitor: polls VN stock quotes for active price alerts
 * + open portfolio positions (SL/TP). Mounted in AppShell.
 */
export function PriceAlertEngine() {
  const { settings } = useSettings();
  const enabled = settings.notifications?.priceAlerts !== false;
  const [pollMs, setPollMs] = useState(5_000);

  useEffect(() => {
    const sync = () => {
      const cfg = loadWebhookConfig();
      setPollMs(cfg.pollMs && cfg.pollMs >= 3000 ? cfg.pollMs : 5_000);
    };
    sync();
    window.addEventListener("orca-webhook-changed", sync as EventListener);
    return () => window.removeEventListener("orca-webhook-changed", sync as EventListener);
  }, []);

  usePriceAlertMonitor(enabled ? pollMs : 0);

  return null;
}
