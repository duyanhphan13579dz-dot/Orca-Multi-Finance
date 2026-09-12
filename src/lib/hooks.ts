"use client";

import { useEffect, useSyncExternalStore } from "react";
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

const fetcher = async <T>(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<ApiResponse<T>> => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
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

/** Shared: one visibility listener for every API hook on the page. */
let pageVisible = true;
const visibilityListeners = new Set<() => void>();

function syncPageVisibility() {
  pageVisible = document.visibilityState === "visible";
  visibilityListeners.forEach((listener) => listener());
}

function subscribePageVisibility(listener: () => void) {
  if (visibilityListeners.size === 0) {
    pageVisible = document.visibilityState === "visible";
    document.addEventListener("visibilitychange", syncPageVisibility);
  }
  visibilityListeners.add(listener);
  return () => {
    visibilityListeners.delete(listener);
    if (visibilityListeners.size === 0) document.removeEventListener("visibilitychange", syncPageVisibility);
  };
}

function getPageVisibility() {
  return pageVisible;
}

function getServerPageVisibility() {
  return true;
}

function usePageVisible(): boolean {
  return useSyncExternalStore(subscribePageVisibility, getPageVisibility, getServerPageVisibility);
}

export function useApi<T>(url: string | null, opts?: { refreshInterval?: number; timeoutMs?: number }) {
  const rt = getSettingsSnapshot().realtime;
  const visible = usePageVisible();

  const baseRefresh = resolveRefresh(opts?.refreshInterval);
  // Pause polling in background tabs — big win on mobile battery & server load
  const refreshInterval = visible && rt.liveUpdates ? baseRefresh : 0;

  const { data, error, isLoading, isValidating, mutate } = useSWR<ApiResponse<T>>(
    url,
    (key: string) => fetcher<T>(key, opts?.timeoutMs ?? FETCH_TIMEOUT_MS),
    {
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
    },
  );

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
