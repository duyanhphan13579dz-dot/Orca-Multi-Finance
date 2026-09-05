import { db } from "@/db";
import { sessions, auditLogs } from "@/db/schema";
import { and, eq, gt } from "drizzle-orm";
import { badRequest, fail, ok } from "@/lib/envelope";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** List active sessions (Security settings). */
export async function GET() {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Chưa đăng nhập", 401);
  const rows = await db
    .select({ id: sessions.id, createdAt: sessions.createdAt, userAgent: sessions.userAgent, ip: sessions.ip, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(and(eq(sessions.userId, session.id), gt(sessions.expiresAt, new Date())));
  return ok(
    {
      sessions: rows
        .map((r) => ({ ...r, current: r.id === session.sessionId }))
        .sort((a, b) => (a.current ? -1 : b.current ? 1 : b.createdAt.getTime() - a.createdAt.getTime())),
    },
    { source: "orca-auth" },
  );
}

/** Revoke a session by id. */
export async function DELETE(req: Request) {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Chưa đăng nhập", 401);
  const body = (await req.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id) return badRequest("Thiếu session id");
  await db.delete(sessions).where(and(eq(sessions.id, body.id), eq(sessions.userId, session.id))).catch(() => {});
  await db.insert(auditLogs).values({ userId: session.id, action: "session_revoke", meta: { id: body.id } }).catch(() => {});
  return ok({ revoked: true, current: body.id === session.sessionId }, { source: "orca-auth" });
}
