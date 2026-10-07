import { ok, notFound, badRequest } from "@/lib/envelope";
import { getDerivativesHistory } from "@/lib/services/derivatives";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/derivatives/history?symbol=VN30F1M&limit=48 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol");
  if (!symbol?.trim()) return badRequest("symbol is required");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 48) || 48, 96);
  const r = await getDerivativesHistory(symbol.trim(), limit);
  if (!r) return notFound(`Unknown derivative symbol: ${symbol.toUpperCase()}`);
  return ok(r.data, r.meta);
}
