"use client";

/**
 * SWR persistent cache — wraps Map with localStorage persistence for keys that
 * benefit from instant stale-while-revalidate (market intel, news, etc.).
 * TTL default 60s; on read, returns stale if fresh fetch pending.
 * This dramatically reduces “white flash” and repeat fetches after tab switch.
 */

const LS_PREFIX = "orca.swr.";
const TTL_MS = 60_000;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function loadEntry(key: string): unknown | undefined {
  if (!isBrowser()) return undefined;
  try {
    const raw = window.localStorage.getItem(LS_PREFIX + key);
    if (!raw) return undefined;
    const obj = JSON.parse(raw) as { v: unknown; t: number };
    if (!obj || typeof obj.t !== "number") return undefined;
    if (Date.now() - obj.t > TTL_MS * 3) {
      // stale beyond 3x TTL — drop
      window.localStorage.removeItem(LS_PREFIX + key);
      return undefined;
    }
    return obj.v;
  } catch {
    return undefined;
  }
}

function saveEntry(key: string, value: unknown): void {
  if (!isBrowser()) return;
  try {
    // avoid storing huge payloads (>200KB stringified)
    const json = JSON.stringify({ v: value, t: Date.now() });
    if (json.length > 200_000) return;
    window.localStorage.setItem(LS_PREFIX + key, json);
  } catch {
    // quota — clear oldest
    try {
      const keys: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k?.startsWith(LS_PREFIX)) keys.push(k);
      }
      if (keys.length > 20) {
        keys.slice(0, 5).forEach((k) => window.localStorage.removeItem(k));
      }
    } catch {}
  }
}

// Minimal SWR cache interface: Map-like with get/set/delete/keys
// See SWR docs: `SWRConfig` `provider` should return Map.
export function createPersistentCache(): Map<string, unknown> {
  const map = new Map<string, unknown>();

  // Hydrate from localStorage for known hot keys on init (sync)
  if (isBrowser()) {
    try {
      const hotKeys = [
        "/api/v1/market/intel",
        "/api/v1/market/snapshot",
        "/api/v1/news?limit=5",
        "/api/v1/crypto/markets?limit=120",
      ];
      for (const k of hotKeys) {
        const v = loadEntry(k);
        if (v !== undefined) map.set(k, v);
      }
    } catch {}
  }

  // Wrap methods to persist on set
  const origSet = map.set.bind(map);
  const origDelete = map.delete.bind(map);
  const origClear = map.clear.bind(map);

  (map as unknown as { set: (k: string, v: unknown) => Map<string, unknown> }).set = (k: string, v: unknown) => {
    origSet(k, v);
    // only persist SWR data entries (string keys starting with /api)
    if (typeof k === "string" && k.startsWith("/api/")) {
      saveEntry(k, v);
    }
    return map;
  };
  (map as unknown as { delete: (k: string) => boolean }).delete = (k: string) => {
    const r = origDelete(k);
    if (typeof k === "string" && k.startsWith("/api/")) {
      try {
        window.localStorage.removeItem(LS_PREFIX + k);
      } catch {}
    }
    return r;
  };
  (map as unknown as { clear: () => void }).clear = () => {
    origClear();
    if (isBrowser()) {
      try {
        const keys: string[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k?.startsWith(LS_PREFIX)) keys.push(k);
        }
        keys.forEach((k) => window.localStorage.removeItem(k));
      } catch {}
    }
  };

  return map;
}
