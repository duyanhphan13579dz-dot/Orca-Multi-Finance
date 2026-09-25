"use client";

import { useSettings } from "@/lib/settings";
import { usePriceAlertMonitor } from "@/lib/hooks/use-price-alerts";

/** Mount once in AppShell — only polls when priceAlerts setting is on. */
export function PriceAlertMonitorHost() {
  const { settings } = useSettings();
  const enabled = settings.notifications.priceAlerts;
  usePriceAlertMonitor(enabled ? 15_000 : 0);
  return null;
}
