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
 * Ưu tiên tải dữ liệu trang tổng quan trước tiên để giao diện xuất hiện nhanh nhất.
 * Sau đó, khi máy rảnh (idle), mới tải ngầm dần dần các trang khác để giảm tải tài nguyên.
 */
function WarmCriticalApis() {
  useEffect(() => {
    // 1. Chỉ nạp dữ liệu trang tổng quan trước tiên
    prefetchApi("/api/v1/stocks?board=vn30", 5_000);
    const tIntel = window.setTimeout(() => prefetchApi("/api/v1/market/intel", 12_000), 250);
    const tGlobal = window.setTimeout(() => prefetchApi("/api/v1/market/global", 10_000), 600);

    // Không nạp ngầm nếu người dùng bật chế độ tiết kiệm dữ liệu mạng
    const navAny = typeof navigator !== "undefined" ? (navigator as unknown as { connection?: { saveData?: boolean } }) : null;
    if (navAny?.connection?.saveData) {
      return () => {
        clearTimeout(tIntel);
        clearTimeout(tGlobal);
      };
    }

    // 2. Sau đó mới tải ngầm dần dần các trang khác (giãn cách theo nhịp idle để không nghẽn băng thông)
    const backgroundQueue: { url: string; timeout: number; delay: number }[] = [
      { url: "/api/v1/crypto/markets", timeout: 10_000, delay: 5_000 },
      { url: "/api/v1/forex/markets", timeout: 12_000, delay: 9_000 },
      { url: "/api/v1/stocks?board=full", timeout: 12_000, delay: 13_000 },
      { url: "/api/v1/commodities", timeout: 10_000, delay: 17_000 },
      { url: "/api/v1/news", timeout: 10_000, delay: 21_000 },
    ];

    const timers: number[] = [];
    for (const item of backgroundQueue) {
      const t = window.setTimeout(() => {
        if (typeof window !== "undefined" && "requestIdleCallback" in window) {
          (window as unknown as { requestIdleCallback: (cb: () => void, opts: { timeout: number }) => number }).requestIdleCallback(
            () => prefetchApi(item.url, item.timeout),
            { timeout: 3_000 },
          );
        } else {
          prefetchApi(item.url, item.timeout);
        }
      }, item.delay);
      timers.push(t);
    }

    return () => {
      window.clearTimeout(tIntel);
      window.clearTimeout(tGlobal);
      for (const t of timers) window.clearTimeout(t);
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
