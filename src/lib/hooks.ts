"use client";

import { useRef, useSyncExternalStore } from "react";
import useSWR from "swr";
import type { ApiResponse } from "./types";
import { getSettingsSnapshot, resolveRefresh } from "./settings";

/**
 * Client data hooks — every call goes through the internal API only.
 * Refresh behavior follows the user's Data & Realtime settings:
 * liveUpdates off → no polling; lowDataMode → aggressively throttled;
 * backgroundRefresh → revalidate on window focus; autoReconnect → SWR retry.
 * Tab hidden → polling paused (saves battery + backend load).
 * Adaptive: LIVE → tighter poll; STALE/UNAVAILABLE → back off.
 */

const FETCH_TIMEOUT_MS = 22_000;
const CLIENT_DEDUPE_MS = 1_500;
const pendingFetches = new Map<string, { promise: Promise<ApiResponse<unknown>>; startedAt: number }>();

const fetcher = async <T>(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<ApiResponse<T>> => {
  const existing = pendingFetches.get(url);
  if (existing && Date.now() - existing.startedAt < CLIENT_DEDUPE_MS) return existing.promise as Promise<ApiResponse<T>>;

  const promise = fetcherUncached<T>(url, timeoutMs);
  pendingFetches.set(url, { promise: promise as Promise<ApiResponse<unknown>>, startedAt: Date.now() });
  void promise.then(
    () => {
      const current = pendingFetches.get(url);
      if (current?.promise === promise) pendingFetches.delete(url);
    },
    () => {
      const current = pendingFetches.get(url);
      if (current?.promise === promise) pendingFetches.delete(url);
    },
  );
  return promise;
};

const fetcherUncached = async <T>(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<ApiResponse<T>> => {
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
  const freshnessRef = useRef<string | undefined>(undefined);

  // Adaptive: LIVE → tighter poll; STALE/UNAVAILABLE → back off; pause in background tabs
  const adaptiveBase = (() => {
    const f = freshnessRef.current;
    if (f === "STALE" || f === "UNAVAILABLE") return Math.max(baseRefresh, 28_000);
    if (f === "DELAYED" || f === "DEGRADED") return Math.max(baseRefresh, 18_000);
    if (f === "LIVE") return Math.max(8_000, Math.min(baseRefresh, 12_000));
    return baseRefresh;
  })();
  const refreshInterval = visible && rt.liveUpdates ? adaptiveBase : 0;

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
      onSuccess: (payload) => {
        if (payload?.success && payload.meta?.freshness) {
          freshnessRef.current = payload.meta.freshness;
        }
      },
    },
  );

  // Keep ref in sync when data already present (hydration / cache)
  if (data?.success && data.meta?.freshness && freshnessRef.current !== data.meta.freshness) {
    freshnessRef.current = data.meta.freshness;
  }

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
