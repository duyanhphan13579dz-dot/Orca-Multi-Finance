import "server-only";
import { desc, eq, like } from "drizzle-orm";
import { databaseConfigured, db } from "../../db";
import { marketSnapshots } from "../../db/schema";

export type MarketScanPhase = "fundamental" | "minervini";

export type ScanChunk<T> = {
  offset: number;
  scanned: number;
  withData: number;
  rows: T[];
  skipped?: number;
  generatedAt: number;
};

type ScanProgress = {
  cycle: string;
  universeSize: number;
  chunkSize: number;
  completedOffsets: number[];
  updatedAt: number;
};

type ScanManifest = {
  cycle: string;
  universeSize: number;
  chunkSize: number;
  chunkCount: number;
  publishedAt: number;
};

function scope(phase: MarketScanPhase, suffix: string): string {
  return `market-screener:${phase}:${suffix}`;
}

/** Stable Vietnam-local cycle key; chunks from different days are never mixed. */
export function marketScanCycle(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now).replaceAll("-", "");
}

/** Return the next unprocessed slice for sequential external cron invocations. */
export async function nextMarketScanOffset(args: {
  phase: MarketScanPhase;
  cycle: string;
  universeSize: number;
  chunkSize: number;
}): Promise<number | null> {
  const { phase, cycle, universeSize, chunkSize } = args;
  const expectedChunks = Math.ceil(universeSize / chunkSize);
  const state = await latestPayload<ScanProgress>(scope(phase, `${cycle}:progress`));
  if (state?.cycle !== cycle || state.universeSize !== universeSize || state.chunkSize !== chunkSize) return 0;
  const completed = new Set(state.completedOffsets);
  for (let index = 0; index < expectedChunks; index++) {
    const offset = index * chunkSize;
    if (!completed.has(offset)) return offset;
  }
  return null;
}

async function latestPayload<T>(key: string): Promise<T | null> {
  if (!databaseConfigured()) return null;
  try {
    const rows = await db
      .select({ payload: marketSnapshots.payload })
      .from(marketSnapshots)
      .where(eq(marketSnapshots.scope, key))
      .orderBy(desc(marketSnapshots.createdAt))
      .limit(1);
    return (rows[0]?.payload as T | undefined) ?? null;
  } catch {
    return null;
  }
}

async function appendSnapshot(key: string, payload: unknown): Promise<boolean> {
  if (!databaseConfigured()) return false;
  try {
    const existing = await db
      .select({ id: marketSnapshots.id })
      .from(marketSnapshots)
      .where(eq(marketSnapshots.scope, key))
      .orderBy(desc(marketSnapshots.createdAt))
      .limit(1);
    if (existing[0]) {
      await db
        .update(marketSnapshots)
        .set({ payload, createdAt: new Date() })
        .where(eq(marketSnapshots.id, existing[0].id));
    } else {
      await db.insert(marketSnapshots).values({ scope: key, payload });
    }
    return true;
  } catch {
    return false;
  }
}

/** Persist a completed per-universe slice, then publish a manifest only after every slice exists. */
export async function writeMarketScanChunk<T>(args: {
  phase: MarketScanPhase;
  cycle: string;
  universeSize: number;
  chunkSize: number;
  chunk: ScanChunk<T>;
}): Promise<{ stored: boolean; complete: boolean; completedChunks: number; expectedChunks: number }> {
  const { phase, cycle, universeSize, chunkSize, chunk } = args;
  const expectedChunks = Math.ceil(universeSize / chunkSize);
  const key = scope(phase, `${cycle}:chunk:${chunk.offset}`);
  const stored = await appendSnapshot(key, chunk);
  if (!stored) return { stored: false, complete: false, completedChunks: 0, expectedChunks };

  const stateKey = scope(phase, `${cycle}:progress`);
  const previous = await latestPayload<ScanProgress>(stateKey);
  const compatible = previous?.cycle === cycle &&
    previous.universeSize === universeSize && previous.chunkSize === chunkSize;
  const completed = new Set(compatible ? previous.completedOffsets : []);
  completed.add(chunk.offset);
  const progress: ScanProgress = {
    cycle,
    universeSize,
    chunkSize,
    completedOffsets: [...completed].sort((a, b) => a - b),
    updatedAt: Date.now(),
  };
  await appendSnapshot(stateKey, progress);

  const complete = progress.completedOffsets.length >= expectedChunks &&
    Array.from({ length: expectedChunks }, (_, i) => i * chunkSize).every((offset) => completed.has(offset));
  if (complete) {
    const manifest: ScanManifest = {
      cycle,
      universeSize,
      chunkSize,
      chunkCount: expectedChunks,
      publishedAt: Date.now(),
    };
    await appendSnapshot(scope(phase, "latest"), manifest);
  }
  return { stored: true, complete, completedChunks: completed.size, expectedChunks };
}

/** Read a published full-market snapshot; uncompleted cycles are intentionally invisible to users. */
export async function readLatestMarketScan<T>(phase: MarketScanPhase, maxAgeMs = 72 * 60 * 60_000): Promise<{
  rows: T[];
  scanned: number;
  withData: number;
  skipped: number;
  cycle: string;
  ageMs: number;
} | null> {
  const manifest = await latestPayload<ScanManifest>(scope(phase, "latest"));
  if (!manifest || !manifest.publishedAt || Date.now() - manifest.publishedAt > maxAgeMs) return null;
  if (!databaseConfigured()) return null;

  const chunkPrefix = scope(phase, `${manifest.cycle}:chunk:`);
  try {
    const records = await db
      .select({ scope: marketSnapshots.scope, payload: marketSnapshots.payload, createdAt: marketSnapshots.createdAt })
      .from(marketSnapshots)
      .where(like(marketSnapshots.scope, `${chunkPrefix}%`))
      .orderBy(desc(marketSnapshots.createdAt));

    const byOffset = new Map<number, ScanChunk<T>>();
    for (const record of records) {
      const offset = Number(record.scope.slice(chunkPrefix.length));
      if (!Number.isInteger(offset) || byOffset.has(offset)) continue;
      const payload = record.payload as ScanChunk<T> | null;
      if (payload && Array.isArray(payload.rows)) byOffset.set(offset, payload);
    }
    if (byOffset.size < manifest.chunkCount) return null;

    const chunks = [...byOffset.entries()]
      .sort(([a], [b]) => a - b)
      .slice(0, manifest.chunkCount)
      .map(([, chunk]) => chunk);
    if (chunks.reduce((sum, chunk) => sum + chunk.scanned, 0) < manifest.universeSize) return null;

    return {
      rows: chunks.flatMap((chunk) => chunk.rows),
      scanned: chunks.reduce((sum, chunk) => sum + chunk.scanned, 0),
      withData: chunks.reduce((sum, chunk) => sum + chunk.withData, 0),
      skipped: chunks.reduce((sum, chunk) => sum + (chunk.skipped ?? Math.max(0, chunk.scanned - chunk.withData)), 0),
      cycle: manifest.cycle,
      ageMs: Date.now() - manifest.publishedAt,
    };
  } catch {
    return null;
  }
}
