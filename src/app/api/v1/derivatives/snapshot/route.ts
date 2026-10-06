import { ok } from "@/lib/envelope";
import { getDerivativesSnapshot } from "@/lib/services/derivatives";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/derivatives/snapshot
 * Query: symbols=VN30F1M,VN30F2M  |  core=1 (default VN30 ACTIVE only)
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbolsParam = url.searchParams.get("symbols");
  const core = url.searchParams.get("core");
  const symbols = symbolsParam
    ? symbolsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const { data, meta } = await getDerivativesSnapshot({
    symbols,
    coreOnly: core === "0" || core === "false" ? false : true,
  });
  return ok(data, meta);
}
