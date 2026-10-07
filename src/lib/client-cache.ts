"use client";

/**
 * In-memory last-good API payloads for instant paint when hopping tabs.
 * Complements SWR — survives component unmount within the SPA session.
 * Tuned for rapid multi-tab navigation: larger pool, sticky core keys.
 */

type Entry = { at: number; payload: unknown; hits: number };

const MAX_ENTRIES = 72;
const DEFAULT_TTL_MS = 240_000;
/** Core market endpoints keep longer so tab-hop never blanks. */
const STICKY_TTL_MS = 420_000;
const store = new Map<string, Entry>();

const STICKY_PREFIXES = [
  "/api/v1/market/",
  "/api/v1/stocks",
  "/api/v1/crypto",
  "/api/v1/forex",
  "/api/v1/commodities",
  "/api/v1/news",
  "/api/v1/macro-economic",
];

function isSticky(key: string): boolean {
  return STICKY_PREFIXES.some((p) => key === p || key.startsWith(p));
}

function ttlFor(key: string, maxAgeMs?: number): number {
  if (maxAgeMs != null) return maxAgeMs;
  return isSticky(key) ? STICKY_TTL_MS : DEFAULT_TTL_MS;
}

function trim() {
  if (store.size <= MAX_ENTRIES) return;
  // Prefer dropping cold, non-sticky, least-hit entries first
  const ordered = [...store.entries()].sort((a, b) => {
    const stickyA = isSticky(a[0]) ? 1 : 0;
    const stickyB = isSticky(b[0]) ? 1 : 0;
    if (stickyA !== stickyB) return stickyA - stickyB;
    if (a[1].hits !== b[1].hits) return a[1].hits - b[1].hits;
    return a[1].at - b[1].at;
  });
  const drop = ordered.slice(0, store.size - MAX_ENTRIES);
  for (const [k] of drop) store.delete(k);
}

export function clientCacheGet<T>(key: string, maxAgeMs?: number): T | undefined {
  const e = store.get(key);
  if (!e) return undefined;
  if (Date.now() - e.at > ttlFor(key, maxAgeMs)) {
    store.delete(key);
    return undefined;
  }
  e.hits += 1;
  return e.payload as T;
}

export function clientCacheSet(key: string, payload: unknown) {
  const prev = store.get(key);
  store.set(key, { at: Date.now(), payload, hits: prev?.hits ?? 0 });
  trim();
}

export function clientCachePeekAge(key: string): number | null {
  const e = store.get(key);
  if (!e) return null;
  return Date.now() - e.at;
}

export function clientCacheHas(key: string, maxAgeMs?: number): boolean {
  return clientCacheGet(key, maxAgeMs) !== undefined;
}

/** Warm cache without blocking UI — used on nav hover/intent. */
export function clientCacheWarm(url: string, timeoutMs = 8_000): void {
  if (typeof window === "undefined") return;
  if (clientCacheHas(url, 60_000)) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  void fetch(url, {
    headers: { Accept: "application/json" },
    signal: ctrl.signal,
    cache: "no-store",
  })
    .then((res) => res.json().catch(() => null))
    .then((json) => {
      if (json && typeof json === "object" && (json as { success?: boolean }).success) {
        clientCacheSet(url, json);
      }
    })
    .catch(() => {})
    .finally(() => clearTimeout(timer));
}
