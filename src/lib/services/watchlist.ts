import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { watchlists, watchlistItems } from "@/db/schema";

/** Shared storage helpers for the watchlist (REST route + realtime gateway). */

export async function defaultWatchlistId(userId: string): Promise<string> {
  const [row] = await db.select({ id: watchlists.id }).from(watchlists).where(eq(watchlists.userId, userId)).limit(1);
  if (row) return row.id;
  const [created] = await db.insert(watchlists).values({ userId, name: "Default" }).returning({ id: watchlists.id });
  return created.id;
}

export async function defaultWatchlistItems(userId: string): Promise<{ assetType: string; symbol: string }[]> {
  const listId = await defaultWatchlistId(userId);
  return await db
    .select({ assetType: watchlistItems.assetType, symbol: watchlistItems.symbol })
    .from(watchlistItems)
    .where(eq(watchlistItems.watchlistId, listId));
}
