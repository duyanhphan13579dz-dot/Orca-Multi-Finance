"use client";

/**
 * In-memory last-good API payloads for instant paint when hopping tabs.
 * Complements SWR — survives component unmount within the SPA session.
 */

type Entry = { at: number; payload: unknown };

const MAX_ENTRIES = 48;
const DEFAULT_TTL_MS = 180_000;
const store = new Map<string, Entry>();

function trim() {
  if (store.size <= MAX_ENTRIES) return;
  const ordered = [...store.entries()].sort((a, b) => a[1].at - b[1].at);
  const drop = ordered.slice(0, store.size - MAX_ENTRIES);
  for (const [k] of drop) store.delete(k);
}

export function clientCacheGet<T>(key: string, maxAgeMs = DEFAULT_TTL_MS): T | undefined {
  const e = store.get(key);
  if (!e) return undefined;
  if (Date.now() - e.at > maxAgeMs) {
    store.delete(key);
    return undefined;
  }
  return e.payload as T;
}

export function clientCacheSet(key: string, payload: unknown) {
  store.set(key, { at: Date.now(), payload });
  trim();
}

export function clientCachePeekAge(key: string): number | null {
  const e = store.get(key);
  if (!e) return null;
  return Date.now() - e.at;
}
