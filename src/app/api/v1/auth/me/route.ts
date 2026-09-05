import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { fail, ok } from "@/lib/envelope";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Chưa đăng nhập", 401);
  const [user] = await db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.id, session.id)).limit(1);
  if (!user) return fail("UNAUTHENTICATED", "Phiên không hợp lệ", 401);
  return ok({ user }, { source: "orca-auth" });
}
