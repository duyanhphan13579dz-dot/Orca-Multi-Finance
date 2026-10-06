import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userPreferences } from "@/db/schema";
import { fail, ok, badRequest } from "@/lib/envelope";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 512_000;

export type PfSyncPayload = {
  profile?: unknown;
  snapshots?: unknown;
  assumptions?: unknown;
  goals?: unknown;
  updatedAt?: number;
};

/** GET /api/v1/pf — load personal finance blob for the logged-in user */
export async function GET() {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Đăng nhập để đồng bộ tài chính cá nhân", 401);

  try {
    const [row] = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, session.id))
      .limit(1);

    const pf = (row?.personalFinance as PfSyncPayload | null) ?? null;
    return ok(
      {
        personalFinance: pf,
        updatedAt: pf?.updatedAt ?? (row?.updatedAt ? row.updatedAt.getTime() : 0),
      },
      { source: "orca-pf" },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "db error";
    if (/personal_finance|column/i.test(msg)) {
      return ok(
        { personalFinance: null, updatedAt: 0, migrationRequired: true },
        { source: "orca-pf", note: "Chạy migration 003_user_personal_finance.sql" },
      );
    }
    return fail("PF_READ_FAILED", msg, 500);
  }
}

/** PUT /api/v1/pf — upsert personal finance blob */
export async function PUT(req: Request) {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Đăng nhập để đồng bộ tài chính cá nhân", 401);

  const body = (await req.json().catch(() => null)) as {
    personalFinance?: PfSyncPayload;
  } | null;

  if (!body?.personalFinance || typeof body.personalFinance !== "object") {
    return badRequest("Payload personalFinance không hợp lệ");
  }

  const payload: PfSyncPayload = {
    ...body.personalFinance,
    updatedAt: body.personalFinance.updatedAt ?? Date.now(),
  };

  const size = JSON.stringify(payload).length;
  if (size > MAX_BYTES) return badRequest(`Dữ liệu PF quá lớn (${size} > ${MAX_BYTES} bytes)`);

  try {
    await db
      .insert(userPreferences)
      .values({
        userId: session.id,
        settings: {},
        personalFinance: payload as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: {
          personalFinance: payload as Record<string, unknown>,
          updatedAt: new Date(),
        },
      });

    return ok({ saved: true, updatedAt: payload.updatedAt, bytes: size }, { source: "orca-pf" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "db error";
    if (/personal_finance|column/i.test(msg)) {
      return fail(
        "MIGRATION_REQUIRED",
        "Chạy drizzle/manual/003_user_personal_finance.sql rồi deploy lại",
        503,
      );
    }
    return fail("PF_WRITE_FAILED", msg, 500);
  }
}
