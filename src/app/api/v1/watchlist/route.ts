import { db, databaseConfigured } from "@/db";
import { watchlists, watchlistItems } from "@/db/schema";
import { fail, ok, badRequest } from "@/lib/envelope";
import { getSessionUser } from "@/lib/auth";
import { eq, asc } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export interface WatchItemPayload {
  assetType: "stock" | "crypto" | "forex" | "commodity";
  symbol: string;
  addedAt?: number;
}

/**
 * Lấy danh sách watchlist của người dùng đã đăng nhập từ database.
 */
export async function GET() {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Đăng nhập để đồng bộ watchlist", 401);
  if (!databaseConfigured()) {
    return ok({ items: [] }, { source: "orca-watchlist-mock" });
  }

  try {
    const [userWatchlist] = await db
      .select()
      .from(watchlists)
      .where(eq(watchlists.userId, session.id))
      .limit(1);

    if (!userWatchlist) {
      return ok({ items: [] }, { source: "orca-watchlist" });
    }

    const items = await db
      .select()
      .from(watchlistItems)
      .where(eq(watchlistItems.watchlistId, userWatchlist.id))
      .orderBy(asc(watchlistItems.sortOrder), asc(watchlistItems.addedAt));

    return ok(
      {
        items: items.map((i) => ({
          assetType: i.assetType as "stock" | "crypto" | "forex" | "commodity",
          symbol: i.symbol,
          addedAt: i.addedAt.getTime(),
        })),
      },
      { source: "orca-watchlist" },
    );
  } catch (e) {
    console.error("[Watchlist] GET failed:", e);
    return fail("DATABASE_ERROR", "Không thể lấy danh sách watchlist", 500);
  }
}

/**
 * Đồng bộ danh sách watchlist của người dùng đã đăng nhập vào database.
 */
export async function PUT(req: Request) {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Đăng nhập để đồng bộ watchlist", 401);
  if (!databaseConfigured()) {
    return ok({ saved: true, count: 0 }, { source: "orca-watchlist-mock" });
  }

  const body = (await req.json().catch(() => null)) as { items?: WatchItemPayload[] } | null;
  if (!body || !Array.isArray(body.items)) {
    return badRequest("Danh sách items không hợp lệ");
  }

  // Tối đa 200 items trong watchlist cá nhân
  const cleanItems = body.items
    .slice(0, 200)
    .filter((i) => i && typeof i.symbol === "string" && typeof i.assetType === "string");

  try {
    let [userWatchlist] = await db
      .select()
      .from(watchlists)
      .where(eq(watchlists.userId, session.id))
      .limit(1);

    if (!userWatchlist) {
      const [created] = await db
        .insert(watchlists)
        .values({ userId: session.id, name: "Default" })
        .returning();
      userWatchlist = created;
    }

    // Làm mới danh sách items theo thứ tự
    await db.delete(watchlistItems).where(eq(watchlistItems.watchlistId, userWatchlist.id));

    if (cleanItems.length > 0) {
      await db.insert(watchlistItems).values(
        cleanItems.map((item, idx) => ({
          watchlistId: userWatchlist.id,
          assetType: item.assetType,
          symbol: item.symbol.toUpperCase(),
          sortOrder: idx,
          addedAt: item.addedAt ? new Date(item.addedAt) : new Date(),
        })),
      );
    }

    return ok({ saved: true, count: cleanItems.length }, { source: "orca-watchlist" });
  } catch (e) {
    console.error("[Watchlist] PUT failed:", e);
    return fail("DATABASE_ERROR", "Không thể cập nhật danh sách watchlist", 500);
  }
}
