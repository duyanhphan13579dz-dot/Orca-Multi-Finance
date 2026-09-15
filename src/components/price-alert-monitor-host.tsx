"use client";

import { usePriceAlertMonitor } from "@/lib/hooks/use-price-alerts";

/** Mount once in AppShell to poll active price alerts app-wide. */
export function PriceAlertMonitorHost() {
  usePriceAlertMonitor(15_000);
  return null;
}
