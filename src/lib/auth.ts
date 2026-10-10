import "server-only";
import crypto from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { eq, and, gt } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { sessions, users } from "@/db/schema";
import { env } from "./env";

/**
 * Authentication: email/password with scrypt hashes, JWT access in httpOnly
 * cookie, DB-backed session records (revocable, listed in Security settings).
 */

/** Khóa chỉ dùng cho `next dev` / test cục bộ. KHÔNG bao giờ được dùng ở production. */
const DEV_ONLY_SECRET = "orca-local-dev-only-secret-never-use-in-production";
const MIN_SECRET_LEN = 32;

let cachedKey: Uint8Array | null = null;

/**
 * Lấy khóa ký JWT, tính lười (lúc có request) để `next build` không bị ảnh hưởng.
 * Production mà thiếu JWT_SECRET (hoặc ngắn hơn 32 ký tự) → ném lỗi, tức là từ chối đăng nhập
 * thay vì âm thầm ký bằng một khóa công khai trong mã nguồn.
 */
function getKey(): Uint8Array {
  if (cachedKey) return cachedKey;
  const secret = env.jwtSecret;
  if (env.nodeEnv === "production") {
    if (!secret || secret.length < MIN_SECRET_LEN || secret === DEV_ONLY_SECRET) {
      throw new Error(
        "JWT_SECRET chưa được cấu hình đúng trên server (cần chuỗi ngẫu nhiên >= 32 ký tự, tạo bằng: openssl rand -hex 32)",
      );
    }
    cachedKey = new TextEncoder().encode(secret);
  } else {
    cachedKey = new TextEncoder().encode(secret ?? DEV_ONLY_SECRET);
  }
  return cachedKey;
}

const COOKIE = "orca_session";
const SESSION_DAYS = 7;

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const known = Buffer.from(hash, "hex");
  return candidate.length === known.length && crypto.timingSafeEqual(candidate, known);
}

async function requestMeta(): Promise<{ userAgent: string | null; ip: string | null }> {
  try {
    const h = await headers();
    return {
      userAgent: h.get("user-agent"),
      // Cloudflare edge IP is authoritative; x-forwarded-for is spoofable.
      ip:
        h.get("cf-connecting-ip")?.trim() ||
        h.get("true-client-ip")?.trim() ||
        h.get("x-real-ip")?.trim() ||
        h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        null,
    };
  } catch {
    return { userAgent: null, ip: null };
  }
}

export async function createSessionCookie(userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(getKey());
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
  const { userAgent, ip } = await requestMeta();
  await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: sha256(token),
      userAgent,
      ip,
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000),
    })
    .catch(() => {});
  return token;
}

export async function clearSessionCookie() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token))).catch(() => {});
  }
  jar.delete(COOKIE);
}

export interface SessionUser {
  id: string;
  sessionId?: string;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const jar = await cookies();
    const token = jar.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, getKey());
    if (!payload.sub) return null;
    const hash = sha256(token);
    const [row] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.tokenHash, hash), gt(sessions.expiresAt, new Date())))
      .limit(1)
      .catch(() => []);

    if (databaseConfigured()) {
      // Khi DB kết nối, nếu bản ghi session không tồn tại (đã bị thu hồi hoặc hết hạn), từ chối phiên
      if (!row) return null;
      return { id: payload.sub, sessionId: row.id };
    }

    // Môi trường dev không kết nối DB thật
    return { id: payload.sub, sessionId: row?.id };
  } catch {
    return null;
  }
}

export async function getUserById(id: string) {
  const [user] = await db.select({ id: users.id, email: users.email, name: users.name, createdAt: users.createdAt }).from(users).where(eq(users.id, id)).limit(1);
  return user ?? null;
}

export const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;
