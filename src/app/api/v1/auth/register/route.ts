import { db } from "@/db";
import { users, auditLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { fail, badRequest, ok, tooMany } from "@/lib/envelope";
import { createSessionCookie, hashPassword, isValidEmail } from "@/lib/auth";
import { assertSecureEnv } from "@/lib/env";
import { takeRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REGISTER_WINDOW_MS = 60 * 60_000;
const REGISTER_PER_IP = 10;

export async function POST(req: Request) {
  try {
    const cfg = assertSecureEnv();
    if (cfg) return fail("INSECURE_CONFIG", cfg, 503);
    const body = (await req.json().catch(() => null)) as { email?: string; password?: string; name?: string } | null;
    const email = body?.email?.trim().toLowerCase();
    const password = body?.password ?? "";
    const name = body?.name?.trim().slice(0, 80) || null;
    if (!email || !isValidEmail(email)) return badRequest("Email không hợp lệ");
    if (password.length < 8) return badRequest("Mật khẩu tối thiểu 8 ký tự");
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (!takeRateLimit(`register:ip:${ip}`, REGISTER_PER_IP, REGISTER_WINDOW_MS))
      return tooMany("Quá nhiều tài khoản được tạo từ địa chỉ này — thử lại sau một giờ.");
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing.length) return fail("EMAIL_EXISTS", "Email đã được đăng ký", 409);
    const [user] = await db.insert(users).values({ email, passwordHash: hashPassword(password), name }).returning({ id: users.id });
    await createSessionCookie(user.id);
    await db.insert(auditLogs).values({ userId: user.id, action: "register" }).catch(() => {});
    return ok({ user: { id: user.id, email, name } }, { source: "orca-auth" });
  } catch (e) {
    return fail("REGISTER_FAILED", e instanceof Error ? e.message : "unknown", 500);
  }
}
