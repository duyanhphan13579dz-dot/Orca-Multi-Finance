"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import type { ApiResponse } from "./types";
import { getSettingsSnapshot, resolveRefresh } from "./settings";

/**
 * Client data hooks — every call goes through the internal API only.
 * Refresh behavior follows the user's Data & Realtime settings:
 * liveUpdates off → no polling; lowDataMode → aggressively throttled;
 * backgroundRefresh → revalidate on window focus; autoReconnect → SWR retry.
 * Tab hidden → polling paused (saves battery + backend load).
 */

const FETCH_TIMEOUT_MS = 22_000;

const fetcher = async <T>(url: string): Promise<ApiResponse<T>> => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as ApiResponse<T> | null;
    if (!json) throw new Error(`bad_response:${res.status}`);
    return json;
  } finally {
    clearTimeout(timer);
  }
};

/** Shared: pause interval polling while the document is hidden */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const sync = () => setVisible(document.visibilityState === "visible");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  return visible;
}

export function useApi<T>(url: string | null, opts?: { refreshInterval?: number }) {
  const rt = getSettingsSnapshot().realtime;
  const visible = usePageVisible();

  const baseRefresh = resolveRefresh(opts?.refreshInterval);
  // Pause polling in background tabs — big win on mobile battery & server load
  const refreshInterval = visible && rt.liveUpdates ? baseRefresh : 0;

  const { data, error, isLoading, isValidating, mutate } = useSWR<ApiResponse<T>>(url, fetcher<T>, {
    refreshInterval,
    revalidateOnFocus: rt.backgroundRefresh,
    revalidateOnReconnect: rt.autoReconnect,
    focusThrottleInterval: rt.lowDataMode ? 60_000 : 30_000,
    shouldRetryOnError: rt.autoReconnect,
    errorRetryInterval: rt.lowDataMode ? 60_000 : 15_000,
    errorRetryCount: rt.autoReconnect ? 3 : 0,
    keepPreviousData: true,
    dedupingInterval: rt.lowDataMode ? 20_000 : 6_000,
    suspense: false,
  });

  return {
    res: data ?? null,
    data: data?.success ? data.data : null,
    meta: data?.success ? data.meta : null,
    error,
    isLoading,
    isValidating,
    mutate,
  };
}
