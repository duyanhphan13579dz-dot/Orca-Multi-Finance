import { ok } from "@/lib/envelope";
import { getDerivativesAlerts } from "@/lib/services/derivatives";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/derivatives/alerts?underlying=VN30 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const underlying = url.searchParams.get("underlying") ?? "VN30";
  const { data, meta } = await getDerivativesAlerts(underlying);
  return ok(data, meta);
}
