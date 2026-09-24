"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import useSWR from "swr";
import type { ApiResponse } from "./types";
import { getSettingsSnapshot, resolveRefresh } from "./settings";
import { clientCacheGet, clientCacheSet, clientCacheHas } from "./client-cache";

/**
 * Client data hooks — every call goes through the internal API only.
 * Tuned for fastest perceived load:
 *  - last-good cache → instant paint on tab hop
 *  - short client dedupe + nav freeze to avoid request storms
 *  - adaptive poll; pause when tab hidden
 *  - isLoading only when no fallback (no blank flash)
 */

const FETCH_TIMEOUT_MS = 11_000;
const CLIENT_DEDUPE_MS = 2_400;
const pendingFetches = new Map<string, { promise: Promise<ApiResponse<unknown>>; startedAt: number }>();

/** Soft freeze window after route change — skip non-critical revalidations. */
let navFreezeUntil = 0;
export function markAppNavigating(ms = 380) {
  navFreezeUntil = Date.now() + ms;
}

export function isNavFrozen(): boolean {
  return typeof window !== "undefined" && Date.now() < navFreezeUntil;
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
    if (json.success) clientCacheSet(url, json);
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
  const inNavFreeze = isNavFrozen();
  // If we already have warm cache for this URL, shorten freeze impact (revalidate sooner)
  const hasWarm = url ? clientCacheHas(url, 90_000) : false;
  const refreshInterval = visible && rt.liveUpdates && !inNavFreeze ? adaptiveBase : 0;

  const fallbackData = useMemo(() => {
    if (!url) return undefined;
    return clientCacheGet<ApiResponse<T>>(url);
  }, [url]);

  const { data, error, isLoading, isValidating, mutate } = useSWR<ApiResponse<T>>(
    url,
    (key: string) => fetcher<T>(key, opts?.timeoutMs ?? FETCH_TIMEOUT_MS),
    {
      refreshInterval,
      revalidateOnFocus: rt.backgroundRefresh && !inNavFreeze,
      revalidateOnReconnect: rt.autoReconnect,
      focusThrottleInterval: rt.lowDataMode ? 60_000 : 28_000,
      shouldRetryOnError: rt.autoReconnect,
      errorRetryInterval: rt.lowDataMode ? 45_000 : 10_000,
      errorRetryCount: rt.autoReconnect ? 2 : 0,
      keepPreviousData: true,
      // Instant paint from session last-good when remounting after tab hop
      fallbackData,
      // Warm cache → revalidate in background; cold → still fetch
      revalidateIfStale: true,
      // Short dedupe so parallel widgets share one flight; long enough for tab hop
      dedupingInterval: rt.lowDataMode ? 16_000 : 4_000,
      suspense: false,
      onSuccess: (payload) => {
        if (payload?.success) {
          clientCacheSet(url!, payload);
          if (payload.meta?.freshness) freshnessRef.current = payload.meta.freshness;
        }
      },
      onError: () => {
        // Keep showing last-good; SWR already falls back via keepPreviousData/fallbackData
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
    }, left + 30);
    return () => window.clearTimeout(t);
  }, [url, visible, mutate, hasWarm]);

  // Never treat as "loading" when we already have paintable data (cache or previous)
  const effectiveLoading = Boolean(isLoading && !data && !fallbackData);

  return {
    res: data ?? fallbackData ?? null,
    data: data?.success ? data.data : fallbackData?.success ? (fallbackData.data as T) : null,
    meta: data?.success ? data.meta : fallbackData?.success ? fallbackData.meta : null,
    error,
    isLoading: effectiveLoading,
    isValidating,
    mutate,
  };
}
