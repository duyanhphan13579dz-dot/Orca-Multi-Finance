import { db } from "@/db";
import { userPreferences } from "@/db/schema";
import { fail, ok, badRequest } from "@/lib/envelope";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Persistent user settings — synced from the client settings store. */
export async function GET() {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Đăng nhập để đồng bộ settings", 401);
  const [row] = await db.select().from(userPreferences).where(eq(userPreferences.userId, session.id)).limit(1);
  return ok(
    row
      ? { settings: row.settings, updatedAt: row.updatedAt.getTime() }
      : { settings: null, updatedAt: 0 },
    { source: "orca-settings" },
  );
}

import { eq } from "drizzle-orm";

export async function PUT(req: Request) {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Đăng nhập để đồng bộ settings", 401);
  const body = (await req.json().catch(() => null)) as { settings?: unknown } | null;
  if (!body?.settings || typeof body.settings !== "object") return badRequest("Payload settings không hợp lệ");
  const size = JSON.stringify(body.settings).length;
  if (size > 32_000) return badRequest("Settings quá lớn");
  await db
    .insert(userPreferences)
    .values({ userId: session.id, settings: body.settings as Record<string, unknown>, updatedAt: new Date() })
    .onConflictDoUpdate({ target: userPreferences.userId, set: { settings: body.settings as Record<string, unknown>, updatedAt: new Date() } });
  return ok({ saved: true }, { source: "orca-settings" });
}
