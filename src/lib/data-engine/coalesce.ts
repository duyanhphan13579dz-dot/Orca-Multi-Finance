import "server-only";
import { getHubStore, type HubEntry } from "./request-scope";

/**
 * Singleflight loader:
 * 1) If request hub has value → return it (no source call)
 * 2) If same key in-flight in this request → await that promise
 * 3) Else run producer once, store in hub
 *
 * Outside hub scope, still singleflights process-wide for the duration of the promise.
 */

const globalInflight = new Map<string, Promise<unknown>>();

export async function coalesce<T>(
  key: string,
  producer: () => Promise<T>,
  opts?: { sourceIds?: string[] },
): Promise<T> {
  const store = getHubStore();
  const sourceIds = opts?.sourceIds ?? [];

  if (store) {
    const cached = store.values.get(key);
    if (cached) {
      store.touches.push({ key, sourceId: sourceIds[0] ?? "hub", at: Date.now(), hit: "hub" });
      return cached.value as T;
    }
    const pending = store.inflight.get(key);
    if (pending) {
      store.touches.push({ key, sourceId: sourceIds[0] ?? "hub", at: Date.now(), hit: "inflight" });
      return pending as Promise<T>;
    }
  } else {
    const pending = globalInflight.get(key);
    if (pending) return pending as Promise<T>;
  }

  const run = (async () => {
    if (store) {
      store.touches.push({ key, sourceId: sourceIds[0] ?? "fetch", at: Date.now(), hit: "fetch" });
    }
    const value = await producer();
    if (store) {
      const entry: HubEntry = {
        key,
        sourceIds,
        producedAt: Date.now(),
        value,
      };
      store.values.set(key, entry);
      store.inflight.delete(key);
    } else {
      globalInflight.delete(key);
    }
    return value;
  })();

  if (store) store.inflight.set(key, run);
  else globalInflight.set(key, run);

  try {
    return await run;
  } catch (e) {
    if (store) store.inflight.delete(key);
    else globalInflight.delete(key);
    throw e;
  }
}

/** Read-only peek (no fetch). */
export function hubPeek<T>(key: string): T | undefined {
  const store = getHubStore();
  return store?.values.get(key)?.value as T | undefined;
}
