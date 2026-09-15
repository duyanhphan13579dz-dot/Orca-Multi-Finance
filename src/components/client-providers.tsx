"use client";

import type { ReactNode } from "react";
import { PriceAlertMonitorHost } from "@/components/price-alert-monitor-host";

/** Client-side hosts mounted once for the whole app. */
export function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <>
      <PriceAlertMonitorHost />
      {children}
    </>
  );
}
