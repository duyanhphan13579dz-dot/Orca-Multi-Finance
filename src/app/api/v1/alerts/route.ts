import { fail, ok, badRequest } from "@/lib/envelope";
import { getSessionUser } from "@/lib/auth";
import { createAlert, listAlerts, validateAlertInput } from "@/lib/services/alerts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** List active alerts of the current user. */
export async function GET() {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Chưa đăng nhập", 401);
  return ok({ alerts: await listAlerts(session.id) }, { source: "orca-alerts" });
}

/** Create an alert: { assetType, symbol, condition, threshold }. */
export async function POST(req: Request) {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Chưa đăng nhập", 401);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const v = validateAlertInput(body ?? {});
  if (!v.ok || !v.value || v.value.threshold == null) return badRequest(v.error ?? "Dữ liệu alert không hợp lệ");
  const alert = await createAlert(session.id, { ...v.value, threshold: v.value.threshold });
  return ok({ alert }, { source: "orca-alerts" });
}
