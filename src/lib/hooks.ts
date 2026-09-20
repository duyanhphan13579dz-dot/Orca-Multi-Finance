"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
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
 * Rapid in-app navigation → short revalidate freeze to avoid request storms.
 */

const FETCH_TIMEOUT_MS = 22_000;
const CLIENT_DEDUPE_MS = 2_800;
const pendingFetches = new Map<string, { promise: Promise<ApiResponse<unknown>>; startedAt: number }>();

/** Soft freeze window after route change — skip non-critical revalidations. */
let navFreezeUntil = 0;
export function markAppNavigating(ms = 450) {
  navFreezeUntil = Date.now() + ms;
}

const fetcher = async <T>(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<ApiResponse<T>> => {
  const existing = pendingFetches.get(url);
  if (existing && Date.now() - existing.startedAt < CLIENT_DEDUPE_MS) {
    return existing.promise as Promise<ApiResponse<T>>;
  }

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

  // During rapid tab switches, hold polling so the UI paints first
  const inNavFreeze = typeof window !== "undefined" && Date.now() < navFreezeUntil;
  const refreshInterval = visible && rt.liveUpdates && !inNavFreeze ? adaptiveBase : 0;

  const { data, error, isLoading, isValidating, mutate } = useSWR<ApiResponse<T>>(
    url,
    (key: string) => fetcher<T>(key, opts?.timeoutMs ?? FETCH_TIMEOUT_MS),
    {
      refreshInterval,
      revalidateOnFocus: rt.backgroundRefresh && !inNavFreeze,
      revalidateOnReconnect: rt.autoReconnect,
      focusThrottleInterval: rt.lowDataMode ? 60_000 : 45_000,
      shouldRetryOnError: rt.autoReconnect,
      errorRetryInterval: rt.lowDataMode ? 60_000 : 15_000,
      errorRetryCount: rt.autoReconnect ? 3 : 0,
      keepPreviousData: true,
      // Prefer cached paint when hopping tabs; background revalidate after freeze
      revalidateIfStale: true,
      dedupingInterval: rt.lowDataMode ? 24_000 : 8_000,
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

  // When freeze ends, nudge a light revalidate once (stale-while-revalidate feel)
  useEffect(() => {
    if (!url || !visible) return;
    const left = navFreezeUntil - Date.now();
    if (left <= 0) return;
    const t = window.setTimeout(() => {
      void mutate();
    }, left + 40);
    return () => window.clearTimeout(t);
  }, [url, visible, mutate]);

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
