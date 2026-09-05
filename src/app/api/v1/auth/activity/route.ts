import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { fail, ok } from "@/lib/envelope";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Security: recent account activity (audit trail). */
export async function GET() {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Chưa đăng nhập", 401);
  const rows = await db
    .select({ id: auditLogs.id, action: auditLogs.action, meta: auditLogs.meta, createdAt: auditLogs.createdAt })
    .from(auditLogs)
    .where(eq(auditLogs.userId, session.id))
    .orderBy(desc(auditLogs.createdAt))
    .limit(20)
    .catch(() => []);
  return ok({ activity: rows }, { source: "orca-auth" });
}
