/**
 * UNIFIED EVENT MODEL — typed envelope over the central event bus.
 *
 * Every realtime payload now travels as a RealtimeEvent with:
 *   id      — `channel:{seq}` (globally unique per channel)
 *   channel — canonical channel name (see ./channels.ts)
 *   type    — semantic type (tick / candle.updated / quote / …)
 *   assetType / symbol — routing metadata for stores & the SSE gateway
 *   ts / seq — ordering + staleness checks
 *   payload — event-specific data
 *
 * Redis bridge (optional): when REDIS_URL is configured, events are published
 * to `orca:rt:{channel}` so multiple app instances can fan out the same
 * realtime stream. Subscription re-emits envelopes locally with a seen-set
 * guard to prevent echo loops. Emits are fire-and-forget — bus health never
 * blocks data paths.
 */

import "server-only";
import { eventBus } from "../events";
import { env } from "../env";
import type { ChannelKind } from "./channels";

export interface RealtimeEvent<T = unknown> {
  id: string;
  channel: string;
  type: ChannelKind | string;
  assetType: string | null;
  symbol: string | null;
  ts: number;
  seq: number;
  payload: T;
}

export type EventHandler<T = unknown> = (e: RealtimeEvent<T>) => void;

const seqs = new Map<string, number>();
const RECENT_CAP = 512;
const recent: RealtimeEvent[] = [];
const recentIds = new Set<string>();

/* ------------------------------ Redis bridge ------------------------------ */

type RedisLike = {
  subscribe(channel: string, cb: (err: unknown, channel: string, message: string) => void): unknown;
  publish(channel: string, message: string): Promise<unknown> | unknown;
  unsubscribe(channel: string): unknown;
  quit(): unknown;
};

let redis: RedisLike | null = null;
let redisTried = false;

async function getRedis(): Promise<RedisLike | null> {
  if (redis || redisTried) return redis;
  redisTried = true;
  if (!env.redisUrl) return null;
  try {
    const mod = await import("ioredis");
    const pub = new mod.default(env.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2000 });
    const sub = pub.duplicate();
    pub.on("error", () => {});
    sub.on("error", () => {});
    await pub.connect().catch(() => {});
    redis = pub as unknown as RedisLike;
    // Re-emit remote events locally (dedupe by event id — no echo loops)
    await sub.subscribe("orca:rt").catch(() => {});
    sub.on("message", (_channel: string, message: string) => {
      try {
        const e = JSON.parse(message) as RealtimeEvent;
        if (!e || typeof e.id !== "string") return;
        if (recentIds.has(e.id)) return; // our own echo
        dispatchLocal(e);
      } catch {
        /* malformed remote event */
      }
    });
  } catch {
    redis = null;
  }
  return redis;
}

function publishRemote(e: RealtimeEvent): void {
  if (!redis) return;
  try {
    void (redis as RedisLike).publish("orca:rt", JSON.stringify(e));
  } catch {
    /* bridge is best-effort */
  }
}

/* ------------------------------ envelope core ----------------------------- */

function nextSeq(channel: string): number {
  const n = (seqs.get(channel) ?? 0) + 1;
  seqs.set(channel, n);
  return n;
}

function remember(e: RealtimeEvent): void {
  recent.push(e);
  recentIds.add(e.id);
  if (recent.length > RECENT_CAP) {
    const evicted = recent.shift();
    if (evicted) recentIds.delete(evicted.id);
  }
}

function dispatchLocal(e: RealtimeEvent): void {
  eventBus.emit(e.channel, e);
}

/**
 * Publish a typed event: local bus always; remote Redis (if configured).
 * Thin wrapper — all realtime producers should use this instead of
 * `eventBus.emit` directly so streams are consistent and replayable.
 */
export function emitEvent<T>(
  channel: string,
  type: ChannelKind | string,
  payload: T,
  meta: { assetType?: string | null; symbol?: string | null; ts?: number } = {},
): RealtimeEvent<T> {
  const e: RealtimeEvent<T> = {
    id: `${channel}:${nextSeq(channel)}`,
    channel,
    type,
    assetType: meta.assetType ?? null,
    symbol: meta.symbol ?? null,
    ts: meta.ts ?? Date.now(),
    seq: 0, // filled below for documentation; channel seq is in id
    payload,
  };
  e.seq = Number(e.id.split(":").pop() ?? "0");
  remember(e);
  dispatchLocal(e);
  void getRedis().then((r) => {
    if (r && r !== redis) redis = r;
    publishRemote(e);
  });
  return e;
}

/**
 * Subscribe to a canonical channel, receiving typed envelopes.
 * Handler failures are isolated (one bad subscriber never kills the stream).
 */
export function onEvent<T>(channel: string, handler: EventHandler<T>): () => void {
  return eventBus.on(channel, (raw) => {
    try {
      handler(raw as RealtimeEvent<T>);
    } catch {
      /* isolated */
    }
  });
}

/** Subscribe to every envelope (used by the market store + gateway fan-out). */
export function onAnyEvent(handler: EventHandler): () => void {
  return eventBus.onAny((raw) => {
    try {
      handler(raw as RealtimeEvent);
    } catch {
      /* isolated */
    }
  });
}

/**
 * Unwrap a raw bus payload: returns the inner payload of a RealtimeEvent,
 * or the raw value itself (backward compat with legacy `eventBus.emit`).
 */
export function payloadOf<T>(raw: unknown): T {
  if (raw && typeof raw === "object" && "payload" in (raw as Record<string, unknown>) && "channel" in (raw as Record<string, unknown>)) {
    return (raw as RealtimeEvent).payload as T;
  }
  return raw as T;
}

/** Replay the most recent events for `channel` (bounded ring buffer). */
export function replayEvents(channel: string, limit = 64): RealtimeEvent[] {
  return recent.filter((e) => e.channel === channel).slice(-limit);
}

/** Debug/ops stats. */
export function eventStats(): { channels: number; subs: number; recent: number } {
  const s = eventBus.stats();
  return { channels: s.channels, subs: s.subs, recent: recent.length };
}

export function resetEventModel(): void {
  seqs.clear();
  recent.length = 0;
  recentIds.clear();
}
