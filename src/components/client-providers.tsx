"use client";

import { useEffect, type ReactNode } from "react";
import { SWRConfig } from "swr";
import { PriceAlertMonitorHost } from "@/components/price-alert-monitor-host";
import { PatternAlertMonitorHost } from "@/components/pattern-alert-monitor-host";
import { ErrorBoundary } from "@/components/error-boundary";
import { prefetchMarketSnapshot } from "@/components/ticker-tape";
import { prefetchApi } from "@/lib/hooks";

const globalSwrCache = new Map();

/** Warm critical APIs in staggered order so first paint is not blocked. */
function WarmCriticalApis() {
  useEffect(() => {
    prefetchApi("/api/v1/stocks?board=full", 12_000);
    const t1 = window.setTimeout(() => prefetchApi("/api/v1/market/intel", 14_000), 400);
    const t2 = window.setTimeout(() => prefetchApi("/api/v1/market/global", 12_000), 900);
    const t3 = window.setTimeout(() => prefetchApi("/api/v1/forex/markets", 14_000), 1_200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
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
