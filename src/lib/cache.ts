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
      return { value: e.value as T, cached: true, stale: false, producedAt: e.producedAt };
    }
    // redis mirror (only fills memory, never authoritative)
    const r = await getRedis();
    if (r) {
      try {
        const raw = await r.get(`orca:${key}`);
        if (raw) {
          const parsed = JSON.parse(raw) as Entry & { value: T };
          if (Date.now() < parsed.expiresAt) {
            mem.set(key, parsed);
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
      mem.set(key, entry);
      const r = await getRedis();
      if (r) {
        try {
          await r.set(`orca:${key}`, JSON.stringify(entry), "PX", Math.max(ttlMs, staleMs));
        } catch {
          /* ignore */
        }
      }
      return { value, cached: false, stale: false, producedAt: entry.producedAt };
    } catch (err) {
      const e = mem.get(key);
      if (e && Date.now() < e.staleUntil) {
        staleServed++;
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
  return { entries: mem.size, hits, staleServed, inflight: inflight.size, redisEnabled: Boolean(env.redisUrl) };
}

export async function redisStatus(): Promise<{ configured: boolean; connected: boolean }> {
  if (!env.redisUrl) return { configured: false, connected: false };
  const r = await getRedis();
  return { configured: true, connected: r !== null };
}

/** periodic GC to bound memory */
if (typeof setInterval !== "undefined") {
  const t = setInterval(() => {
    const now = Date.now();
    for (const [k, e] of mem) if (now > e.staleUntil) mem.delete(k);
  }, 60_000);
  if (typeof t.unref === "function") t.unref();
}
