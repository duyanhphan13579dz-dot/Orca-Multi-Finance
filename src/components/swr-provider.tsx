"use client";

import { useMemo } from "react";
import { SWRConfig } from "swr";
import { createPersistentCache } from "@/lib/swr-cache";
import { fetcher } from "@/lib/hooks";

export function AppSWRProvider({ children }: { children: React.ReactNode }) {
  // create once per tab lifetime — stable Map instance prevents #310-style re-init churn
  const cache = useMemo(() => createPersistentCache() as unknown as Map<string, unknown>, []);
  const provider = useMemo(() => () => cache, [cache]);
  return (
    <SWRConfig
      value={{
        // SWR Cache type is `Cache<any>`; we map-persist via Map-like object
        provider: provider as unknown as () => Map<string, unknown> as unknown as never,
        fetcher: fetcher as unknown as never,
        // stronger dedup/caching to avoid flapping on flaky mobile network
        dedupingInterval: 30_000,
        focusThrottleInterval: 30_000,
        errorRetryInterval: 5_000,
        errorRetryCount: 2,
        revalidateOnFocus: false,
        revalidateOnReconnect: true,
        keepPreviousData: true,
      }}
    >
      {children}
    </SWRConfig>
  );
}
