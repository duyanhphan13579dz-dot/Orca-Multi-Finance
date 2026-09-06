import { fail, ok, badRequest, notFound } from "@/lib/envelope";
import { getSessionUser } from "@/lib/auth";
import { deleteAlert, updateAlert } from "@/lib/services/alerts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Toggle/update an alert: { active?, threshold? }. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Chưa đăng nhập", 401);
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { active?: unknown; threshold?: unknown } | null;
  const patch: { active?: boolean; threshold?: number | null } = {};
  if (body?.active != null) patch.active = Boolean(body.active);
  if (body?.threshold !== undefined) {
    if (body.threshold == null || body.threshold === "") patch.threshold = null;
    else {
      const n = Number(body.threshold);
      if (!Number.isFinite(n)) return badRequest("threshold không hợp lệ");
      patch.threshold = n;
    }
  }
  const row = await updateAlert(session.id, id, patch);
  if (!row) return notFound("Alert không tồn tại");
  return ok({ alert: row }, { source: "orca-alerts" });
}

/** Remove an alert. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Chưa đăng nhập", 401);
  const { id } = await ctx.params;
  const removed = await deleteAlert(session.id, id);
  if (!removed) return notFound("Alert không tồn tại");
  return ok({ deleted: true }, { source: "orca-alerts" });
}
