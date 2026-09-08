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

const FETCH_TIMEOUT_MS = 8_000;

// Global fetch dedup: concurrent requests to same URL share a single promise — tăng TTL để giảm ghép yêu cầu
const fetchDedup = new Map<string, Promise<unknown>>();
const FETCH_DEDUP_TTL = 2_000;

const fetcher = async <T>(url: string): Promise<ApiResponse<T>> => {
  const dedupKey = url;
  const existing = fetchDedup.get(dedupKey) as Promise<ApiResponse<T>> | undefined;
  if (existing) return existing;

  const p: Promise<ApiResponse<T>> = (async () => {
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
  })();

  fetchDedup.set(dedupKey, p as Promise<unknown>);
  // auto-expire dedup entry
  setTimeout(() => {
    if (fetchDedup.get(dedupKey) === p) fetchDedup.delete(dedupKey);
  }, FETCH_DEDUP_TTL);
  try {
    return await p;
  } finally {
    // keep dedup window even on error to avoid thundering herd
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
  // Also throttle when lowDataMode to cut 75% requests
  const refreshInterval = visible && rt.liveUpdates ? baseRefresh : 0;

  const { data, error, isLoading, isValidating, mutate } = useSWR<ApiResponse<T>>(url, fetcher<T>, {
    refreshInterval,
    revalidateOnFocus: rt.backgroundRefresh ? true : false,
    revalidateOnReconnect: rt.autoReconnect,
    revalidateIfStale: true,
    focusThrottleInterval: rt.lowDataMode ? 90_000 : 45_000,
    shouldRetryOnError: rt.autoReconnect,
    errorRetryInterval: rt.lowDataMode ? 45_000 : 8_000,
    errorRetryCount: rt.autoReconnect ? 3 : 0,
    keepPreviousData: true,
    dedupingInterval: rt.lowDataMode ? 20_000 : 6_000,
    // Reduce loading flash: deliver stale data while revalidating — tăng tốc first paint
    suspense: false,
    // Avoid fetching same key multiple times within short window across components
    revalidateOnMount: !visible ? false : undefined,
    // Nhanh hơn: loadingTimeout 3s để SWR tự retry nếu fetch treo
    loadingTimeout: 3_000,
  } as unknown as Record<string, unknown>);

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
