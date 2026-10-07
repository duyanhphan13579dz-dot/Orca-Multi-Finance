import { ok } from "@/lib/envelope";
import { getDerivativesRegime } from "@/lib/services/derivatives";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/derivatives/regime?underlying=VN30 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const underlying = url.searchParams.get("underlying") ?? "VN30";
  const { data, meta } = await getDerivativesRegime({ underlying });
  return ok(data, meta);
}
