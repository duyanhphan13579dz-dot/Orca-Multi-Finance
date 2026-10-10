import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { env } from "./env";

/**
 * Multi-tier TTL cache:
 *  - in-memory hot (per isolate)
 *  - Upstash Redis REST mirror (Workers-safe shared)
 *  - optional Redis TCP (Node only)
 *  - stale-while-revalidate + in-flight dedupe
 */

/** Chạy việc nền; trên Workers gắn vào ctx.waitUntil để không bị huỷ khi response kết thúc. */
function defer(p: Promise<unknown>): void {
  const safe = p.catch(() => undefined);
  try {
    getCloudflareContext().ctx.waitUntil(safe);
  } catch {
    /* ngoài Worker: promise tự chạy tiếp */
  }
}

interface Entry {
  value: unknown;
  expiresAt: number;
  staleUntil: number;
  producedAt: number;
}

const mem = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
let hits = 0;
let staleServed = 0;
let bgRefresh = 0;

type RedisLike = { get(k: string): Promise<string | null>; set(k: string, v: string, ...a: unknown[]): Promise<unknown> };
let redis: RedisLike | null = null;
let redisTried = false;

async function getRedis(): Promise<RedisLike | null> {
  if (redis || redisTried) return redis;
  redisTried = true;
  if (!env.redisUrl) return null;
  try {
    const mod = await import("ioredis");
    const client = new mod.default(env.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 1_200,
      enableOfflineQueue: false,
      enableReadyCheck: false,
      commandTimeout: 800,
    });
    client.on("error", () => {});
    await Promise.race([
      client.connect().catch(() => undefined),
      new Promise<void>((r) => setTimeout(r, 1_200)),
    ]);
    const status = (client as { status?: string }).status;
    if (status === "ready" || status === "connect" || status === "connecting") {
      redis = client as unknown as RedisLike;
    } else {
      try {
        client.disconnect(false);
      } catch {
        /* */
      }
      redis = null;
    }
  } catch {
    redis = null;
  }
  return redis;
}

type UpstashRest = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { px?: number }): Promise<void>;
  del(key: string): Promise<void>;
};

let upstash: UpstashRest | null = null;
let upstashTried = false;

async function getUpstash(): Promise<UpstashRest | null> {
  if (upstash || upstashTried) return upstash;
  upstashTried = true;
  const base = env.upstashRestUrl?.replace(/\/$/, "");
  const token = env.upstashRestToken;
  if (!base || !token) return null;

  async function cmd(args: unknown[]): Promise<unknown> {
    const res = await fetch(`${base}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(1_500),
    });
    if (!res.ok) throw new Error(`upstash ${res.status}`);
    const json = (await res.json()) as { result?: unknown };
    return json.result ?? null;
  }

  upstash = {
    async get(key: string) {
      const r = await cmd(["GET", key]);
      return typeof r === "string" ? r : r == null ? null : String(r);
    },
    async set(key: string, value: string, opts?: { px?: number }) {
      if (opts?.px && opts.px > 0) await cmd(["SET", key, value, "PX", opts.px]);
      else await cmd(["SET", key, value]);
    },
    async del(key: string) {
      await cmd(["DEL", key]);
    },
  };
  return upstash;
}

async function mirrorGet(key: string): Promise<string | null> {
  const u = await getUpstash();
  if (u) {
    try {
      return await u.get(`orca:${key}`);
    } catch {
      /* */
    }
  }
  const r = await getRedis();
  if (!r) return null;
  try {
    return await r.get(`orca:${key}`);
  } catch {
    return null;
  }
}

async function mirrorSet(key: string, payload: string, ttlMs: number, staleMs: number): Promise<void> {
  const px = Math.max(ttlMs + staleMs, 1_000);
  const u = await getUpstash();
  if (u) {
    try {
      await u.set(`orca:${key}`, payload, { px });
      return;
    } catch {
      /* */
    }
  }
  const r = await getRedis();
  if (!r) return;
  try {
    await r.set(`orca:${key}`, payload, "PX", px);
  } catch {
    /* */
  }
}

export interface CacheResult<T> {
  value: T;
  cached: boolean;
  stale: boolean;
  producedAt: number;
}

function storeEntry(key: string, value: unknown, ttlMs: number, staleMs: number): Entry {
  const entry: Entry = {
    value,
    expiresAt: Date.now() + ttlMs,
    staleUntil: Date.now() + staleMs,
    producedAt: Date.now(),
  };
  mem.set(key, entry);
  defer(mirrorSet(key, JSON.stringify(entry), ttlMs, staleMs));
  return entry;
}

async function runProducer<T>(
  key: string,
  ttlMs: number,
  staleMs: number,
  producer: () => Promise<T>,
): Promise<CacheResult<T>> {
  try {
    const value = await producer();
    const entry = storeEntry(key, value, ttlMs, staleMs);
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
}

export async function cached<T>(
  key: string,
  opts: { ttlMs: number; staleMs: number; softSwr?: boolean; skipCache?: boolean; producer: () => Promise<T> },
): Promise<CacheResult<T>> {
  const { ttlMs, staleMs, producer } = opts;
  const softSwr = opts.softSwr !== false;
  if (opts.skipCache) {
    return runProducer(key, ttlMs, staleMs, producer);
  }

  const refreshInBackground = () => {
    if (inflight.has(key)) return;
    bgRefresh++;
    const task = runProducer(key, ttlMs, staleMs, producer);
    inflight.set(key, task as Promise<unknown>);
    defer(task);
  };

  const now = Date.now();
  const e = mem.get(key);
  if (e && now < e.expiresAt) {
    hits++;
    return { value: e.value as T, cached: true, stale: false, producedAt: e.producedAt };
  }
  if (e && softSwr && now < e.staleUntil) {
    hits++;
    staleServed++;
    refreshInBackground();
    return { value: e.value as T, cached: true, stale: true, producedAt: e.producedAt };
  }

  // Một request đang chạy cho cùng key → dùng chung, không gọi mirror/upstream lần nữa.
  const pending = inflight.get(key);
  if (pending) return (await pending) as CacheResult<T>;

  // Isolate lạnh (hoặc entry hết hạn hẳn): thử mirror dùng chung (Upstash/Redis) trước khi gọi upstream.
  try {
    const raw = await mirrorGet(key);
    if (raw) {
      const parsed = JSON.parse(raw) as Entry & { value: T };
      const t = Date.now();
      if (t < parsed.expiresAt) {
        mem.set(key, parsed);
        hits++;
        return { value: parsed.value, cached: true, stale: false, producedAt: parsed.producedAt };
      }
      if (softSwr && t < parsed.staleUntil) {
        mem.set(key, parsed);
        hits++;
        staleServed++;
        refreshInBackground();
        return { value: parsed.value, cached: true, stale: true, producedAt: parsed.producedAt };
      }
    }
  } catch {
    /* mirror hỏng → gọi producer */
  }

  const racing = inflight.get(key);
  if (racing) return (await racing) as CacheResult<T>;
  const task = runProducer(key, ttlMs, staleMs, producer);
  inflight.set(key, task as Promise<unknown>);
  return task;
}

/** Xoá cache bộ nhớ của isolate này (dùng cho test / mô phỏng isolate lạnh). */
export function clearMemoryCache(): void {
  mem.clear();
  inflight.clear();
}

export function peekStale<T>(key: string): CacheResult<T> | null {
  const e = mem.get(key);
  if (!e) return null;
  return { value: e.value as T, cached: true, stale: true, producedAt: e.producedAt };
}

export function cacheStats() {
  return {
    entries: mem.size,
    hits,
    staleServed,
    bgRefresh,
    inflight: inflight.size,
    redisEnabled: Boolean(env.redisUrl || (env.upstashRestUrl && env.upstashRestToken)),
    redisNote: env.redisNote,
    upstashRest: Boolean(env.upstashRestUrl && env.upstashRestToken),
  };
}

export async function redisStatus(): Promise<{
  configured: boolean;
  connected: boolean;
  note?: string;
  backend?: string;
}> {
  if (env.upstashRestUrl && env.upstashRestToken) {
    const u = await getUpstash();
    return {
      configured: true,
      connected: u !== null,
      backend: "upstash-rest",
      note: u ? "Upstash REST ready (Workers-safe)." : "Upstash REST configured but probe failed — in-memory only.",
    };
  }
  if (!env.redisUrl) return { configured: false, connected: false, note: env.redisNote };
  const r = await getRedis();
  return {
    configured: true,
    connected: r !== null,
    backend: "redis-tcp",
    note: r ? undefined : "Không kết nối được Redis TCP — dùng UPSTASH_REDIS_REST_* trên Workers.",
  };
}

export async function invalidate(key: string): Promise<void> {
  mem.delete(key);
  inflight.delete(key);
  try {
    const u = await getUpstash();
    if (u) {
      await u.del(`orca:${key}`);
      return;
    }
  } catch {
    /* */
  }
  const r = await getRedis();
  if (r) {
    try {
      const client = r as RedisLike & { del?: (k: string) => Promise<unknown> };
      if (typeof client.del === "function") await client.del(`orca:${key}`);
      else await r.set(`orca:${key}`, "", "PX", 1);
    } catch {
      /* */
    }
  }
}

const isWorkersRuntime =
  process.env.CLOUDFLARE_WORKERS === "1" ||
  process.env.NEXT_RUNTIME === "edge" ||
  typeof (globalThis as { WebSocketPair?: unknown }).WebSocketPair !== "undefined";
if (typeof setInterval !== "undefined" && !isWorkersRuntime) {
  const t = setInterval(() => {
    const now = Date.now();
    for (const [k, e] of mem) if (now > e.staleUntil) mem.delete(k);
  }, 60_000);
  if (typeof t.unref === "function") t.unref();
}
