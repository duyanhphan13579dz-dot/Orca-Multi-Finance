import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { financialProfiles, financialMemoryLogs } from "@/db/schema";
import { buildFinancialProfile, type FinancialProfile, type RawProfileInput } from "../finance/financial-profile";

/**
 * FINANCIAL MEMORY — trí nhớ tài chính tách riêng khỏi conversation memory.
 * - Chỉ lưu khi user đồng ý (consent=true).
 * - Mọi thao tác gắn userId (access control; không trộn dữ liệu giữa user).
 * - Cập nhật/xóa được qua API.
 */

export const EMPTY_PROFILE = (): FinancialProfile => buildFinancialProfile({});

async function log(userId: string, action: string, meta: Record<string, unknown> = {}) {
  try {
    await db.insert(financialMemoryLogs).values({ userId, action, meta: meta as never }).catch(() => null);
  } catch {
    /* log chỉ là phụ — không làm hỏng luồng chính */
  }
}

export async function getFinancialProfile(userId: string): Promise<{ profile: FinancialProfile; consent: boolean } | null> {
  const [row] = await db
    .select({ profile: financialProfiles.profile, consent: financialProfiles.consent, updatedAt: financialProfiles.updatedAt })
    .from(financialProfiles)
    .where(eq(financialProfiles.userId, userId))
    .limit(1)
    .catch(() => []);
  if (!row?.profile) return null;
  return { profile: row.profile as FinancialProfile, consent: row.consent };
}

/** Lưu profile: yêu cầu consent=true; trả về profile đã chuẩn hóa. */
export async function saveFinancialProfile(userId: string, input: RawProfileInput, consent: boolean): Promise<{
  ok: boolean;
  profile?: FinancialProfile;
  errors?: string[];
  message?: string;
}> {
  if (!consent) return { ok: false, message: "Cần người dùng đồng ý lưu trí nhớ tài chính (consent) trước khi ghi dữ liệu." };
  const profile = buildFinancialProfile(input);
  if (!profile.valid) {
    return { ok: false, errors: Object.entries(profile.errors).flatMap(([k, v]) => (v ?? []).map((m) => `${k}: ${m}`)) };
  }
  try {
    await db
      .insert(financialProfiles)
      .values({
        userId,
        profile: profile as never,
        consent: true,
        consentAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: financialProfiles.userId,
        set: { profile: profile as never, consent: true, consentAt: new Date(), updatedAt: new Date() },
      });
    await log(userId, "upsert", { fields: Object.keys(input) });
    return { ok: true, profile };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Không lưu được profile" };
  }
}

export async function deleteFinancialProfile(userId: string): Promise<{ ok: boolean }> {
  try {
    await db.delete(financialProfiles).where(eq(financialProfiles.userId, userId));
    await log(userId, "delete");
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function setFinancialConsent(userId: string, consent: boolean): Promise<{ ok: boolean; message?: string }> {
  try {
    if (consent) {
      await db.insert(financialProfiles).values({ userId, profile: EMPTY_PROFILE() as never, consent: true, consentAt: new Date() }).onConflictDoUpdate({
        target: financialProfiles.userId,
        set: { consent: true, consentAt: new Date() },
      });
    } else {
      await db.update(financialProfiles).set({ consent: false }).where(eq(financialProfiles.userId, userId));
      // GDPR-ish: không có consent → xóa dữ liệu profile
      await db.delete(financialProfiles).where(eq(financialProfiles.userId, userId));
    }
    await log(userId, "consent", { consent });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Không cập nhật được consent" };
  }
}
