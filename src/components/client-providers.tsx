"use client";

import { useEffect, type ReactNode } from "react";
import { SWRConfig } from "swr";
import { PriceAlertMonitorHost } from "@/components/price-alert-monitor-host";
import { PatternAlertMonitorHost } from "@/components/pattern-alert-monitor-host";
import { ErrorBoundary } from "@/components/error-boundary";
import { prefetchMarketSnapshot } from "@/components/ticker-tape";
import { prefetchApi } from "@/lib/hooks";

const globalSwrCache = new Map();

/**
 * P3-A: Warm critical APIs in staggered order so first paint is not blocked.
 * Priority: VN30 board (fast) → intel → global → forex → full board → crypto → screener defaults.
 */
function WarmCriticalApis() {
  useEffect(() => {
    // Fast path first — VN30 board for dashboard/stocks first paint
    prefetchApi("/api/v1/stocks?board=vn30", 5_000);
    const t1 = window.setTimeout(() => prefetchApi("/api/v1/market/intel", 12_000), 250);
    const t2 = window.setTimeout(() => prefetchApi("/api/v1/market/global", 10_000), 600);
    const t3 = window.setTimeout(() => prefetchApi("/api/v1/forex/markets", 12_000), 900);
    const t4 = window.setTimeout(() => prefetchApi("/api/v1/stocks?board=full", 12_000), 1_200);
    const t5 = window.setTimeout(() => prefetchApi("/api/v1/crypto/markets", 10_000), 1_600);
    const t6 = window.setTimeout(() => prefetchApi("/api/v1/screener/fundamental", 14_000), 2_200);
    const t7 = window.setTimeout(() => prefetchApi("/api/v1/screener/valuation", 14_000), 2_600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
      clearTimeout(t6);
      clearTimeout(t7);
    };
  }, []);
  return null;
}

export function ClientProviders({ children }: { children: ReactNode }) {
  useEffect(() => {
    prefetchMarketSnapshot();
  }, []);

  return (
    <SWRConfig
      value={{
        provider: () => globalSwrCache,
        revalidateOnFocus: false,
        revalidateOnReconnect: true,
        keepPreviousData: true,
        dedupingInterval: 4_000,
        focusThrottleInterval: 28_000,
        errorRetryCount: 2,
        errorRetryInterval: 10_000,
        shouldRetryOnError: true,
        suspense: false,
        revalidateIfStale: true,
      }}
    >
      <ErrorBoundary name="app-root">
        <PriceAlertMonitorHost />
        <PatternAlertMonitorHost />
        <WarmCriticalApis />
        {children}
      </ErrorBoundary>
    </SWRConfig>
  );
}
