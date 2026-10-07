import "server-only";
import crypto from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { eq, and, gt } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { env } from "./env";

/**
 * Authentication: email/password with scrypt hashes, JWT access in httpOnly
 * cookie, DB-backed session records (revocable, listed in Security settings).
 */

const key = new TextEncoder().encode(env.jwtSecret);
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
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
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
    .sign(key);
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
    const { payload } = await jwtVerify(token, key);
    if (!payload.sub) return null;
    const hash = sha256(token);
    const [row] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.tokenHash, hash), gt(sessions.expiresAt, new Date())))
      .limit(1)
      .catch(() => []);
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
