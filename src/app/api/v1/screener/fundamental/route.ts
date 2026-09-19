import { ok, fail } from "@/lib/envelope";
import { screenFundamental } from "@/lib/services/fundamental-screener";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const symbols = url.searchParams.get("symbols")?.split(/[,,\s;]+/).filter(Boolean);
    const sector = url.searchParams.get("sector") ?? "";
    const values = Object.fromEntries(["minRoe", "maxRoe", "minRoa", "maxRoa", "minRos", "maxRos", "minRoic", "maxRoic", "minGrossMargin", "maxGrossMargin", "minNetMargin", "maxNetMargin"].map((key) => [key, Number(url.searchParams.get(key))]));
    const result = await screenFundamental({ symbols, sector });
    const rows = result.rows.filter((row) => {
      if (sector && row.sector !== sector) return false;
      return (!Number.isFinite(values.minRoe) || (row.roe != null && row.roe >= values.minRoe)) && (!Number.isFinite(values.maxRoe) || (row.roe != null && row.roe <= values.maxRoe)) && (!Number.isFinite(values.minRoa) || (row.roa != null && row.roa >= values.minRoa)) && (!Number.isFinite(values.maxRoa) || (row.roa != null && row.roa <= values.maxRoa)) && (!Number.isFinite(values.minRos) || (row.ros != null && row.ros >= values.minRos)) && (!Number.isFinite(values.maxRos) || (row.ros != null && row.ros <= values.maxRos)) && (!Number.isFinite(values.minRoic) || (row.roic != null && row.roic >= values.minRoic)) && (!Number.isFinite(values.maxRoic) || (row.roic != null && row.roic <= values.maxRoic)) && (!Number.isFinite(values.minGrossMargin) || (row.grossMargin != null && row.grossMargin >= values.minGrossMargin)) && (!Number.isFinite(values.maxGrossMargin) || (row.grossMargin != null && row.grossMargin <= values.maxGrossMargin)) && (!Number.isFinite(values.minNetMargin) || (row.netMargin != null && row.netMargin >= values.minNetMargin)) && (!Number.isFinite(values.maxNetMargin) || (row.netMargin != null && row.netMargin <= values.maxNetMargin));
    });
    return ok({ rows, scanned: result.scanned, skipped: result.skipped }, result.meta);
  } catch (error) {
    return fail("FUNDAMENTAL_SCREENER_ERROR", error instanceof Error ? error.message : "Không thể quét chỉ số cơ bản", 500);
  }
}
