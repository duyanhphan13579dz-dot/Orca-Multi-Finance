import "server-only";
import { env } from "./env";

/**
 * P0/P3 last-good snapshots for hot APIs.
 * Survives isolate recycling via Upstash REST when configured;
 * always has in-memory L1 for the current isolate.
 *
 * Goal: cold request can return partial in <2s when a warm cron
 * has populated the slot within SNAPSHOT_MAX_AGE_MS.
 */

export type HotSlot =
  | "board"
  | "intel"
  | "forex"
  | "global"
  | "multi-asset"
  | "crypto"
  | "commodities"
  | "screener-fundamental"
  | "screener-valuation"
  | "screener-minervini";

type SlotEntry = {
  data: unknown;
  meta: Record<string, unknown>;
  at: number;
};

const mem = new Map<HotSlot, SlotEntry>();

/** Prefer serving last-good if younger than this (2h). */
export const SNAPSHOT_MAX_AGE_MS = 2 * 60 * 60_000;

/** Fresh enough to skip heavy recompute on read path (45s). */
export const SNAPSHOT_FRESH_MS = 45_000;

function keyOf(slot: HotSlot): string {
  return `orca:hot:${slot}`;
}

async function upstashSet(key: string, payload: string, pxMs: number): Promise<void> {
  const base = env.upstashRestUrl?.replace(/\/$/, "");
  const token = env.upstashRestToken;
  if (!base || !token) return;
  try {
    await fetch(base, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(["SET", key, payload, "PX", pxMs]),
      signal: AbortSignal.timeout(1_200),
    });
  } catch {
    /* */
  }
}

async function upstashGet(key: string): Promise<string | null> {
  const base = env.upstashRestUrl?.replace(/\/$/, "");
  const token = env.upstashRestToken;
  if (!base || !token) return null;
  try {
    const res = await fetch(base, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(["GET", key]),
      signal: AbortSignal.timeout(1_200),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: unknown };
    return typeof json.result === "string" ? json.result : null;
  } catch {
    return null;
  }
}

export function putHot(
  slot: HotSlot,
  data: unknown,
  meta: object = {},
): void {
  if (data == null) return;
  const entry: SlotEntry = {
    data,
    meta: { ...meta, hotSlot: slot },
    at: Date.now(),
  };
  mem.set(slot, entry);
  const payload = JSON.stringify(entry);
  void upstashSet(keyOf(slot), payload, SNAPSHOT_MAX_AGE_MS);
}

export async function getHot<T = unknown>(
  slot: HotSlot,
): Promise<{ data: T; meta: Record<string, unknown>; ageMs: number; fresh: boolean } | null> {
  const now = Date.now();
  const local = mem.get(slot);
  if (local && now - local.at < SNAPSHOT_MAX_AGE_MS) {
    const ageMs = now - local.at;
    return {
      data: local.data as T,
      meta: {
        ...local.meta,
        source: String(local.meta.source ?? "hot-snapshot"),
        stale: ageMs > SNAPSHOT_FRESH_MS,
        cached: true,
      },
      ageMs,
      fresh: ageMs <= SNAPSHOT_FRESH_MS,
    };
  }

  try {
    const raw = await upstashGet(keyOf(slot));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SlotEntry;
    if (!parsed?.at || now - parsed.at >= SNAPSHOT_MAX_AGE_MS) return null;
    mem.set(slot, parsed);
    const ageMs = now - parsed.at;
    return {
      data: parsed.data as T,
      meta: {
        ...parsed.meta,
        source: String(parsed.meta.source ?? "hot-snapshot"),
        stale: ageMs > SNAPSHOT_FRESH_MS,
        cached: true,
      },
      ageMs,
      fresh: ageMs <= SNAPSHOT_FRESH_MS,
    };
  } catch {
    return null;
  }
}

/** Sync peek — memory only (for fast path inside same isolate). */
export function peekHot<T = unknown>(
  slot: HotSlot,
): { data: T; meta: Record<string, unknown>; ageMs: number; fresh: boolean } | null {
  const local = mem.get(slot);
  if (!local) return null;
  const ageMs = Date.now() - local.at;
  if (ageMs >= SNAPSHOT_MAX_AGE_MS) return null;
  return {
    data: local.data as T,
    meta: {
      ...local.meta,
      source: String(local.meta.source ?? "hot-snapshot"),
      stale: ageMs > SNAPSHOT_FRESH_MS,
      cached: true,
    },
    ageMs,
    fresh: ageMs <= SNAPSHOT_FRESH_MS,
  };
}

export function hotStats(): Record<HotSlot, { ageMs: number | null; has: boolean }> {
  const now = Date.now();
  const slots: HotSlot[] = [
    "board", "intel", "forex", "global", "multi-asset",
    "crypto", "commodities",
    "screener-fundamental", "screener-valuation", "screener-minervini",
  ];
  const out = {} as Record<HotSlot, { ageMs: number | null; has: boolean }>;
  for (const s of slots) {
    const e = mem.get(s);
    out[s] = e ? { ageMs: now - e.at, has: true } : { ageMs: null, has: false };
  }
  return out;
}
