import { db } from "@/db";
import { users, auditLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { badRequest, fail, ok } from "@/lib/envelope";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Update profile fields (display name). */
export async function PATCH(req: Request) {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Chưa đăng nhập", 401);
  const body = (await req.json().catch(() => null)) as { name?: string } | null;
  const name = body?.name?.trim().slice(0, 80) ?? "";
  if (body?.name !== undefined && !name) return badRequest("Tên không hợp lệ");
  if (name) await db.update(users).set({ name }).where(eq(users.id, session.id));
  const [user] = await db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.id, session.id)).limit(1);
  await db.insert(auditLogs).values({ userId: session.id, action: "profile_update" }).catch(() => {});
  return ok({ user }, { source: "orca-auth" });
}
