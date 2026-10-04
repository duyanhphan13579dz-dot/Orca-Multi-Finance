"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import useSWR from "swr";
import type { ApiResponse } from "./types";
import { getSettingsSnapshot, resolveRefresh } from "./settings";
import { clientCacheGet, clientCacheSet, clientCacheHas } from "./client-cache";

const FETCH_TIMEOUT_MS = 9_000;
const CLIENT_DEDUPE_MS = 2_400;
const pendingFetches = new Map<string, { promise: Promise<ApiResponse<unknown>>; startedAt: number }>();

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
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    const msg = e instanceof Error ? e.message : String(e);
    if (name === "AbortError" || /aborted/i.test(msg)) {
      throw new Error(
        `Hết thời gian chờ (${Math.round(timeoutMs / 1000)}s). Thử lại — BCTC có thể đang tải lần đầu.`,
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

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

export function useApi<T>(
  url: string | null,
  opts?: { refreshInterval?: number; timeoutMs?: number; keepPreviousData?: boolean },
) {
  const rt = getSettingsSnapshot().realtime;
  const visible = usePageVisible();

  const baseRefresh = resolveRefresh(opts?.refreshInterval);
  const freshnessRef = useRef<string | undefined>(undefined);

  const adaptiveBase = (() => {
    const f = freshnessRef.current;
    if (f === "STALE" || f === "UNAVAILABLE") return Math.max(baseRefresh, 40_000);
    if (f === "DELAYED" || f === "DEGRADED") return Math.max(baseRefresh, 24_000);
    if (f === "LIVE") return Math.max(8_000, Math.min(baseRefresh, 12_000));
    return baseRefresh;
  })();

  const inNavFreeze = isNavFrozen();
  const hasWarm = url ? clientCacheHas(url, 90_000) : false;
  const refreshInterval = visible && rt.liveUpdates && !inNavFreeze ? adaptiveBase : 0;
  const keepPrev = opts?.keepPreviousData !== false;

  const fallbackData = useMemo(() => {
    if (!url || !keepPrev) return undefined;
    return clientCacheGet<ApiResponse<T>>(url);
  }, [url, keepPrev]);

  const { data, error, isLoading, isValidating, mutate } = useSWR<ApiResponse<T>>(
    url,
    (key: string) => fetcher<T>(key, opts?.timeoutMs ?? FETCH_TIMEOUT_MS),
    {
      refreshInterval,
      revalidateOnFocus: rt.backgroundRefresh && !inNavFreeze,
      revalidateOnReconnect: rt.autoReconnect,
      focusThrottleInterval: rt.lowDataMode ? 60_000 : 18_000,
      shouldRetryOnError: rt.autoReconnect,
      errorRetryInterval: rt.lowDataMode ? 45_000 : 10_000,
      errorRetryCount: rt.autoReconnect ? 2 : 0,
      keepPreviousData: keepPrev,
      fallbackData: keepPrev ? fallbackData : undefined,
      revalidateIfStale: true,
      dedupingInterval: rt.lowDataMode ? 16_000 : 2_800,
      suspense: false,
      onSuccess: (payload) => {
        if (payload?.success) {
          clientCacheSet(url!, payload);
          if (payload.meta?.freshness) freshnessRef.current = payload.meta.freshness;
        }
      },
      onError: () => {},
    },
  );

  if (data?.success && data.meta?.freshness && freshnessRef.current !== data.meta.freshness) {
    freshnessRef.current = data.meta.freshness;
  }

  useEffect(() => {
    if (!url || !visible) return;
    const left = navFreezeUntil - Date.now();
    if (left <= 0) return;
    const t = window.setTimeout(() => {
      void mutate();
    }, left + 30);
    return () => window.clearTimeout(t);
  }, [url, visible, mutate, hasWarm]);

  const resolved = data ?? (keepPrev ? fallbackData : undefined) ?? null;
  const effectiveLoading = Boolean(
    (isLoading || (isValidating && !data?.success)) && !resolved?.success,
  );

  return {
    res: resolved,
    data: resolved?.success ? (resolved.data as T) : null,
    meta: resolved?.success ? resolved.meta : null,
    error,
    isLoading: effectiveLoading,
    isValidating,
    mutate,
  };
}

/** Warm client cache (and dedupe in-flight) so useApi shows data immediately. */
export function prefetchApi(url: string | null | undefined, timeoutMs = FETCH_TIMEOUT_MS): void {
  if (!url || typeof window === "undefined") return;
  if (clientCacheHas(url, 45_000)) return;
  void fetcher(url, timeoutMs).catch(() => undefined);
}
