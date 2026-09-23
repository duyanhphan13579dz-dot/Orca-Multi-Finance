import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request-scoped bag for one agent / API turn.
 * Modules share fetched payloads here so the same source is not hit twice.
 */

export type HubEntry = {
  key: string;
  sourceIds: string[];
  producedAt: number;
  value: unknown;
};

export type DataHubStore = {
  /** Resolved values (success) */
  values: Map<string, HubEntry>;
  /** In-flight producers (singleflight within this request) */
  inflight: Map<string, Promise<unknown>>;
  /** Source touch log for diagnostics */
  touches: Array<{ key: string; sourceId: string; at: number; hit: "fresh" | "hub" | "inflight" | "fetch" }>;
};

const als = new AsyncLocalStorage<DataHubStore>();

export function createHubStore(): DataHubStore {
  return {
    values: new Map(),
    inflight: new Map(),
    touches: [],
  };
}

export function getHubStore(): DataHubStore | undefined {
  return als.getStore();
}

/** Run fn inside a hub scope (agent entry / API handler). Nested calls reuse outer store. */
export function runInDataHub<T>(fn: () => Promise<T>): Promise<T> {
  const existing = als.getStore();
  if (existing) return fn();
  return als.run(createHubStore(), fn);
}

export function hubStats(): {
  active: boolean;
  keys: string[];
  touchCount: number;
  hits: Record<string, number>;
} {
  const s = als.getStore();
  if (!s) return { active: false, keys: [], touchCount: 0, hits: {} };
  const hits: Record<string, number> = {};
  for (const t of s.touches) {
    hits[t.hit] = (hits[t.hit] ?? 0) + 1;
  }
  return {
    active: true,
    keys: [...s.values.keys()],
    touchCount: s.touches.length,
    hits,
  };
}
