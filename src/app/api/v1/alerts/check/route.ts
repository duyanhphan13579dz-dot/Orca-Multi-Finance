import { fail, ok } from "@/lib/envelope";
import { getSessionUser } from "@/lib/auth";
import { checkUserAlerts, persistTriggers } from "@/lib/services/alerts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Manual evaluation of the user's alerts (scheduler also polls automatically). */
export async function POST() {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Chưa đăng nhập", 401);
  const evaluated = await checkUserAlerts(session.id);
  const fired = await persistTriggers(session.id, evaluated);
  return ok(
    { evaluated: evaluated.length, fired: fired.length, results: evaluated },
    { source: "orca-alerts" },
  );
}
