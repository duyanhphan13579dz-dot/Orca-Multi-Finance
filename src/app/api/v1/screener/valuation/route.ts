import { ok, fail } from "@/lib/envelope";
import { screenValuation } from "@/lib/services/valuation-screener";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const symbols = url.searchParams.get("symbols")?.split(/[,\s;]+/).filter(Boolean);
    const sector = url.searchParams.get("sector") ?? "";
    const minPe = Number(url.searchParams.get("minPe"));
    const maxPe = Number(url.searchParams.get("maxPe"));
    const minPb = Number(url.searchParams.get("minPb"));
    const maxPb = Number(url.searchParams.get("maxPb"));
    const minPs = Number(url.searchParams.get("minPs"));
    const maxPs = Number(url.searchParams.get("maxPs"));
    const result = await screenValuation({ symbols, sector });
    const rows = result.rows.filter((row) => {
      if (sector && row.sector !== sector) return false;
      return (!Number.isFinite(minPe) || (row.pe != null && row.pe >= minPe)) && (!Number.isFinite(maxPe) || (row.pe != null && row.pe <= maxPe)) && (!Number.isFinite(minPb) || (row.pb != null && row.pb >= minPb)) && (!Number.isFinite(maxPb) || (row.pb != null && row.pb <= maxPb)) && (!Number.isFinite(minPs) || (row.ps != null && row.ps >= minPs)) && (!Number.isFinite(maxPs) || (row.ps != null && row.ps <= maxPs));
    });
    return ok({ rows, scanned: result.scanned, skipped: result.skipped }, { ...result.meta, note: "P/E, P/B, P/S từ VNDirect ratios; chỉ dùng để sàng lọc, không phải khuyến nghị." });
  } catch (error) {
    return fail("VALUATION_SCREENER_ERROR", error instanceof Error ? error.message : "Không thể quét định giá", 500);
  }
}

