import { ok } from "@/lib/envelope";
import { getDerivativesCatalog } from "@/lib/services/derivatives";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/derivatives/contracts — Contract Master (products + contracts). */
export async function GET() {
  const { data, meta } = await getDerivativesCatalog();
  return ok(data, meta);
}
