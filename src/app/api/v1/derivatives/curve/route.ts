import { ok } from "@/lib/envelope";
import { getDerivativesTermStructure } from "@/lib/services/derivatives";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/derivatives/curve?underlying=VN30
 * Term structure + calendar spreads (P2). Null legs stay null — no invented prices.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const underlying = url.searchParams.get("underlying") ?? "VN30";
  const { data, meta } = await getDerivativesTermStructure({ underlying });
  return ok(data, meta);
}
