"use client";

import useSWR from "swr";
import type { ApiResponse } from "./types";
import { getSettingsSnapshot, resolveRefresh } from "./settings";

/**
 * Client data hooks — every call goes through the internal API only.
 * Refresh behavior follows the user's Data & Realtime settings:
 * liveUpdates off → no polling; lowDataMode → aggressively throttled;
 * backgroundRefresh → revalidate on window focus; autoReconnect → SWR retry.
 */

const fetcher = async <T>(url: string): Promise<ApiResponse<T>> => {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const json = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!json) throw new Error(`bad_response:${res.status}`);
  return json;
};

export function useApi<T>(url: string | null, opts?: { refreshInterval?: number }) {
  const rt = getSettingsSnapshot().realtime;
  const { data, error, isLoading, mutate } = useSWR<ApiResponse<T>>(url, fetcher<T>, {
    refreshInterval: resolveRefresh(opts?.refreshInterval),
    revalidateOnFocus: rt.backgroundRefresh,
    shouldRetryOnError: rt.autoReconnect,
    errorRetryInterval: rt.lowDataMode ? 60_000 : 12_000,
    errorRetryCount: rt.autoReconnect ? 3 : 0,
    keepPreviousData: true,
    dedupingInterval: rt.lowDataMode ? 15_000 : 4_000,
  });
  return { res: data ?? null, data: data?.success ? data.data : null, meta: data?.success ? data.meta : null, error, isLoading, mutate };
}
