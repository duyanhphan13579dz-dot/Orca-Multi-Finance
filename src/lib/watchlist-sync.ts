/**
 * WATCHLIST SYNC — client-side bridge to the server copy.
 * Local-first: UI reads/writes localStorage instantly; the server is updated
 * fire-and-forget when logged in, and used to restore the list on first visit.
 */

import type { WatchItem } from "@/components/watchlist-button";

export async function pushWatchlist(items: WatchItem[]): Promise<void> {
  try {
    await fetch("/api/v1/watchlist", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
  } catch {
    /* offline / not logged in — local copy remains the source of truth */
  }
}

export async function pullWatchlist(): Promise<WatchItem[] | null> {
  try {
    const res = await fetch("/api/v1/watchlist", { credentials: "same-origin" });
    if (!res.ok) return null;
    const body = (await res.json()) as { success: boolean; data?: { items?: { assetType: WatchItem["assetType"]; symbol: string; addedAt?: string }[] } };
    if (!body.success || !body.data?.items) return null;
    return body.data.items
      .filter((i) => i.symbol)
      .map((i) => ({
        assetType: i.assetType,
        symbol: i.symbol.toUpperCase(),
        addedAt: i.addedAt ? Date.parse(i.addedAt) : Date.now(),
      }));
  } catch {
    return null;
  }
}

/** Union server + local (dedupe by assetType+symbol), then persist locally. */
export function mergeWatchlists(local: WatchItem[], server: WatchItem[]): WatchItem[] {
  const map = new Map<string, WatchItem>();
  for (const item of [...server, ...local]) {
    const key = `${item.assetType}:${item.symbol}`;
    const existing = map.get(key);
    if (!existing || (item.addedAt ?? 0) > (existing.addedAt ?? 0)) map.set(key, item);
  }
  return [...map.values()];
}
