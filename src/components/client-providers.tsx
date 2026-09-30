"use client";

import { useEffect, type ReactNode } from "react";
import { SWRConfig } from "swr";
import { PriceAlertMonitorHost } from "@/components/price-alert-monitor-host";
import { PatternAlertMonitorHost } from "@/components/pattern-alert-monitor-host";
import { ErrorBoundary } from "@/components/error-boundary";
import { prefetchMarketSnapshot } from "@/components/ticker-tape";

/** Stable SWR cache across ClientProviders re-renders (tab hops keep data). */
const globalSwrCache = new Map();

/**
 * App-wide client hosts:
 * - SWR defaults tuned for fast tab hops (keep previous, short dedupe)
 * - Soft error boundary so one page crash does not blank the shell
 * - Price alert monitor (singleton)
 * - Candlestick reversal pattern push monitor
 * - Prefetch market snapshot so ticker paints early
 */
export function ClientProviders({ children }: { children: ReactNode }) {
  useEffect(() => {
    prefetchMarketSnapshot();
  }, []);

  return (
    <SWRConfig
      value={{
        provider: () => globalSwrCache,
        revalidateOnFocus: true,
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
        {children}
      </ErrorBoundary>
    </SWRConfig>
  );
}
