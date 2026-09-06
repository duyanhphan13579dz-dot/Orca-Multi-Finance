import { db } from "@/db";
import { users, auditLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { fail, badRequest, ok, tooMany } from "@/lib/envelope";
import { createSessionCookie, isValidEmail, verifyPassword } from "@/lib/auth";
import { assertSecureEnv } from "@/lib/env";
import { takeRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_ATTEMPTS = 10; // per IP+email
const LOGIN_IP_ATTEMPTS = 40; // per raw IP, all emails

export async function POST(req: Request) {
  try {
    const cfg = assertSecureEnv();
    if (cfg) return fail("INSECURE_CONFIG", cfg, 503);
    const body = (await req.json().catch(() => null)) as { email?: string; password?: string } | null;
    const email = body?.email?.trim().toLowerCase();
    const password = body?.password ?? "";
    if (!email || !isValidEmail(email) || !password) return badRequest("Thông tin đăng nhập không hợp lệ");
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (!takeRateLimit(`login:ip:${ip}`, LOGIN_IP_ATTEMPTS, LOGIN_WINDOW_MS))
      return tooMany("Quá nhiều lần thử đăng nhập — thử lại sau ít phút.");
    if (!takeRateLimit(`login:${ip}:${email}`, LOGIN_ATTEMPTS, LOGIN_WINDOW_MS))
      return tooMany("Quá nhiều lần thử cho tài khoản này — thử lại sau ít phút.");
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      if (user) await db.insert(auditLogs).values({ userId: user.id, action: "login_failed" }).catch(() => {});
      return fail("INVALID_CREDENTIALS", "Email hoặc mật khẩu không đúng", 401);
    }
    await createSessionCookie(user.id);
    await db.insert(auditLogs).values({ userId: user.id, action: "login" }).catch(() => {});
    return ok({ user: { id: user.id, email: user.email, name: user.name } }, { source: "orca-auth" });
  } catch (e) {
    return fail("LOGIN_FAILED", e instanceof Error ? e.message : "unknown", 500);
  }
}
