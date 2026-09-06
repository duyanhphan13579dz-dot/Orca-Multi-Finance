import { eq } from "drizzle-orm";
import { db } from "@/db";
import { watchlists, watchlistItems } from "@/db/schema";
import { fail, ok, badRequest } from "@/lib/envelope";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ASSET_TYPES = ["stock", "crypto", "forex", "commodity"] as const;
type ValidAssetType = (typeof ASSET_TYPES)[number];

async function defaultWatchlistId(userId: string): Promise<string> {
  const [row] = await db.select({ id: watchlists.id }).from(watchlists).where(eq(watchlists.userId, userId)).limit(1);
  if (row) return row.id;
  const [created] = await db.insert(watchlists).values({ userId, name: "Default" }).returning({ id: watchlists.id });
  return created.id;
}

/** Read the current user's watchlist (server copy). */
export async function GET() {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Chưa đăng nhập", 401);
  const listId = await defaultWatchlistId(session.id);
  const items = await db
    .select({ assetType: watchlistItems.assetType, symbol: watchlistItems.symbol, addedAt: watchlistItems.addedAt })
    .from(watchlistItems)
    .where(eq(watchlistItems.watchlistId, listId));
  return ok(
    { items: items.map((i) => ({ assetType: i.assetType, symbol: i.symbol, addedAt: i.addedAt.toISOString() })) },
    { source: "orca-watchlist" },
  );
}

/** Replace the server copy with the client list: { items: [{assetType, symbol}] }. */
export async function PUT(req: Request) {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Chưa đăng nhập", 401);
  const body = (await req.json().catch(() => null)) as { items?: { assetType?: string; symbol?: string }[] } | null;
  if (!body?.items || !Array.isArray(body.items)) return badRequest("items phải là mảng");
  if (body.items.length > 200) return badRequest("Watchlist tối đa 200 mục");
  const items: { assetType: ValidAssetType; symbol: string }[] = [];
  for (const raw of body.items) {
    const assetType = raw.assetType as ValidAssetType;
    const symbol = String(raw.symbol ?? "").trim().toUpperCase();
    if (!ASSET_TYPES.includes(assetType) || !/^[A-Z0-9._-]{2,20}$/.test(symbol)) {
      return badRequest("Có mục không hợp lệ (assetType hoặc symbol)");
    }
    items.push({ assetType, symbol });
  }
  const valid = true;
  if (!valid) return badRequest("Có mục không hợp lệ (assetType hoặc symbol)");
  const listId = await defaultWatchlistId(session.id);
  await db.transaction(async (tx) => {
    await tx.delete(watchlistItems).where(eq(watchlistItems.watchlistId, listId));
    if (items.length) {
      await tx.insert(watchlistItems).values(
        items.map((i, idx) => ({ watchlistId: listId, assetType: i.assetType, symbol: i.symbol, sortOrder: idx })),
      );
    }
  });
  return ok({ synced: items.length }, { source: "orca-watchlist" });
}
