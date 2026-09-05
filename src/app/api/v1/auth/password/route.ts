import { db } from "@/db";
import { users, auditLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { badRequest, fail, ok } from "@/lib/envelope";
import { getSessionUser, hashPassword, verifyPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Change password — verifies current hash, writes new scrypt hash, audits. */
export async function POST(req: Request) {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Chưa đăng nhập", 401);
  const body = (await req.json().catch(() => null)) as { current?: string; next?: string } | null;
  const current = body?.current ?? "";
  const next = body?.next ?? "";
  if (!current || next.length < 8) return badRequest("Mật khẩu mới tối thiểu 8 ký tự");
  const [user] = await db.select().from(users).where(eq(users.id, session.id)).limit(1);
  if (!user || !verifyPassword(current, user.passwordHash)) {
    return fail("WRONG_PASSWORD", "Mật khẩu hiện tại không đúng", 403);
  }
  await db.update(users).set({ passwordHash: hashPassword(next) }).where(eq(users.id, session.id));
  await db.insert(auditLogs).values({ userId: session.id, action: "password_change" }).catch(() => {});
  return ok({ changed: true }, { source: "orca-auth" });
}
