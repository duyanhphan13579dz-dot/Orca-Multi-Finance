import "server-only";
import { env } from "./env";

/**
 * Multi-tier TTL cache with:
 *  - in-memory hot cache (always available)
 *  - optional Redis mirror when REDIS_URL is configured
 *  - stale-while-revalidate: last valid value is served as STALE on producer failure
 *  - in-flight request deduplication (single producer per key)
 *
 * Cached data is NEVER silently treated as live — callers check `stale`.
 */

interface Entry {
  value: unknown;
  expiresAt: number; // fresh until
  staleUntil: number; // serve as stale until
  producedAt: number; // when the value was produced
}

const mem = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
let hits = 0;
let staleServed = 0;

// Bound memory: LRU eviction when exceeding limit (prevents unbounded growth under many keys like chart histories)
const MAX_ENTRIES = 600;
const GC_INTERVAL_MS = 30_000;

function touchLRU(key: string, entry: Entry) {
  // Re-insert to mark as recently used (Map preserves insertion order)
  mem.delete(key);
  mem.set(key, entry);
  // Evict oldest if over capacity
  if (mem.size > MAX_ENTRIES) {
    const oldestKey = mem.keys().next().value as string | undefined;
    if (oldestKey) mem.delete(oldestKey);
  }
}

/* ------------------------------ Redis (optional) ----------------------------- */

type RedisLike = { get(k: string): Promise<string | null>; set(k: string, v: string, ...a: unknown[]): Promise<unknown> };
let redis: RedisLike | null = null;
let redisTried = false;

async function getRedis(): Promise<RedisLike | null> {
  if (redis || redisTried) return redis;
  redisTried = true;
  if (!env.redisUrl) return null;
  try {
    const mod = await import("ioredis");
    const client = new mod.default(env.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2000 });
    client.on("error", () => {});
    await client.connect().catch(() => {});
    redis = client as unknown as RedisLike;
  } catch {
    redis = null;
  }
  return redis;
}

/* --------------------------------- API ------------------------------------- */

export interface CacheResult<T> {
  value: T;
  cached: boolean;
  stale: boolean;
  producedAt: number;
}

export async function cached<T>(
  key: string,
  opts: { ttlMs: number; staleMs: number; producer: () => Promise<T>; skipCache?: boolean },
): Promise<CacheResult<T>> {
  const now = Date.now();
  const { ttlMs, staleMs, producer } = opts;

  if (!opts.skipCache) {
    const e = mem.get(key);
    if (e && now < e.expiresAt) {
      hits++;
      touchLRU(key, e);
      return { value: e.value as T, cached: true, stale: false, producedAt: e.producedAt };
    }
    // Also serve stale while revalidating in background? No - let producer handle SWR
    // redis mirror (only fills memory, never authoritative) — fire without awaiting when possible
    // to avoid adding latency to hot path when Redis is slow
    const r = await getRedis();
    if (r) {
      try {
        const raw = await r.get(`orca:${key}`);
        if (raw) {
          const parsed = JSON.parse(raw) as Entry & { value: T };
          if (Date.now() < parsed.expiresAt) {
            touchLRU(key, parsed);
            hits++;
            return { value: parsed.value, cached: true, stale: false, producedAt: parsed.producedAt };
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  const pending = inflight.get(key);
  if (pending) return (await pending) as CacheResult<T>;

  const task = (async (): Promise<CacheResult<T>> => {
    try {
      const value = await producer();
      const entry: Entry = { value, expiresAt: Date.now() + ttlMs, staleUntil: Date.now() + staleMs, producedAt: Date.now() };
      touchLRU(key, entry);
      // Fire-and-forget Redis write (don't block response latency)
      void (async () => {
        const r = await getRedis();
        if (r) {
          try {
            await r.set(`orca:${key}`, JSON.stringify(entry), "PX", Math.max(ttlMs, staleMs));
          } catch {
            /* ignore */
          }
        }
      })();
      return { value, cached: false, stale: false, producedAt: entry.producedAt };
    } catch (err) {
      const e = mem.get(key);
      if (e && Date.now() < e.staleUntil) {
        staleServed++;
        touchLRU(key, e);
        return { value: e.value as T, cached: true, stale: true, producedAt: e.producedAt };
      }
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, task as Promise<unknown>);
  return task;
}

export function peekStale<T>(key: string): CacheResult<T> | null {
  const e = mem.get(key);
  if (!e) return null;
  return { value: e.value as T, cached: true, stale: true, producedAt: e.producedAt };
}

export function cacheStats() {
  return { entries: mem.size, hits, staleServed, inflight: inflight.size, redisEnabled: Boolean(env.redisUrl), redisNote: env.redisNote };
}

export async function redisStatus(): Promise<{ configured: boolean; connected: boolean; note?: string }> {
  if (!env.redisUrl) return { configured: false, connected: false, note: env.redisNote };
  const r = await getRedis();
  return { configured: true, connected: r !== null, note: r ? undefined : "Không kết nối được Redis (sai URL/chặn mạng) — cache vẫn chạy in-memory." };
}

/** Drop memory + Redis entry so next read re-produces. */
export async function invalidate(key: string): Promise<void> {
  mem.delete(key);
  inflight.delete(key);
  const r = await getRedis();
  if (r) {
    try {
      const client = r as RedisLike & { del?: (k: string) => Promise<unknown> };
      if (typeof client.del === "function") await client.del(`orca:${key}`);
      else await r.set(`orca:${key}`, "", "PX", 1);
    } catch {
      /* ignore */
    }
  }
}

/** periodic GC to bound memory — also evicts LRU tail if still over limit */
if (typeof setInterval !== "undefined") {
  const t = setInterval(() => {
    const now = Date.now();
    let expired = 0;
    for (const [k, e] of mem) {
      if (now > e.staleUntil) {
        mem.delete(k);
        expired++;
        // avoid blocking event loop on huge maps
        if (expired > 200) break;
      }
    }
    // If still over capacity, evict oldest
    while (mem.size > MAX_ENTRIES) {
      const oldestKey = mem.keys().next().value as string | undefined;
      if (!oldestKey) break;
      mem.delete(oldestKey);
    }
  }, GC_INTERVAL_MS);
  if (typeof t.unref === "function") t.unref();
}
