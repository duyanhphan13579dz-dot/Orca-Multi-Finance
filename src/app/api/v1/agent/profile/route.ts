import { ok, badRequest, fail } from "@/lib/envelope";
import { getSessionUser } from "@/lib/auth";
import { getFinancialProfile, saveFinancialProfile, deleteFinancialProfile } from "@/lib/agents/financial-memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * FINANCIAL PROFILE (Financial Memory) — access control theo session user.
 * GET  → đọc profile (chỉ tài khoản của chính user).
 * PUT  → tạo/cập nhật profile, BẮT BUỘC consent=true (chỉ lưu khi user đồng ý).
 * DELETE → xóa toàn bộ trí nhớ tài chính.
 */
export async function GET() {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Đăng nhập để dùng trí nhớ tài chính", 401);
  const mem = await getFinancialProfile(session.id);
  if (!mem) {
    return ok({ profile: null, consent: false }, { source: "orca-financial-memory" });
  }
  const p = mem.profile;
  return ok(
    {
      consent: mem.consent,
      completeness: p.completeness,
      inputs: p.inputs,
      derive: {
        age: p.derive.age,
        cashFlow: p.derive.cashFlow,
        netWorth: p.derive.netWorth,
        savingsRate: p.derive.savingsRate,
        debtToIncome: p.derive.debtToIncome,
        emergencyFund: p.derive.emergencyFund,
        health: { overall: p.derive.health.overall, level: p.derive.health.level, metrics: p.derive.health.metrics },
        allocation: p.derive.allocation,
        concentration: p.derive.concentration,
      },
      errors: p.errors,
    },
    { source: "orca-financial-memory" },
  );
}

/** PUT { consent: true, profile: RawProfileInput } */
export async function PUT(req: Request) {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Đăng nhập để lưu hồ sơ tài chính", 401);
  const body = (await req.json().catch(() => null)) as { consent?: boolean; profile?: Record<string, unknown> } | null;
  if (!body?.profile) return badRequest("Thiếu profile");
  const res = await saveFinancialProfile(session.id, body.profile as never, body.consent === true);
  if (!res.ok) {
    const detail = res.errors?.length ? ` — ${res.errors.join("; ")}` : "";
    return badRequest(`${res.message ?? "Không lưu được profile"}${detail}`);
  }
  return ok(
    { saved: true, profile: res.profile },
    { source: "orca-financial-memory", note: res.errors?.length ? `Bỏ qua field không hợp lệ: ${res.errors.join("; ")}` : undefined },
  );
}

export async function DELETE() {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Đăng nhập để xóa trí nhớ tài chính", 401);
  const res = await deleteFinancialProfile(session.id);
  if (!res.ok) return fail("MEMORY_DELETE_FAILED", "Không xóa được trí nhớ tài chính", 502);
  return ok({ deleted: true }, { source: "orca-financial-memory" });
}
