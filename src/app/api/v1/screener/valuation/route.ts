import { ok, fail } from "@/lib/envelope";
import { screenValuation } from "@/lib/services/valuation-screener";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function num(v: string | null): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const symbols = url.searchParams.get("symbols")?.split(/[,\s;]+/).filter(Boolean);
    const sector = url.searchParams.get("sector") ?? undefined;

    const result = await screenValuation({
      symbols,
      sector: sector || undefined,
      minPe: num(url.searchParams.get("minPe")),
      maxPe: num(url.searchParams.get("maxPe")),
      minPb: num(url.searchParams.get("minPb")),
      maxPb: num(url.searchParams.get("maxPb")),
      minPs: num(url.searchParams.get("minPs")),
      maxPs: num(url.searchParams.get("maxPs")),
      minEvEbitda: num(url.searchParams.get("minEvEbitda")),
      maxEvEbitda: num(url.searchParams.get("maxEvEbitda")),
      maxPeg: num(url.searchParams.get("maxPeg")),
      minFcfYield: num(url.searchParams.get("minFcfYield")),
      maxNetDebtEbitda: num(url.searchParams.get("maxNetDebtEbitda")),
      limit: num(url.searchParams.get("limit")),
    });

    return ok(
      {
        rows: result.rows,
        scanned: result.scanned,
        skipped: result.skipped,
        withData: result.withData,
        bctcHit: result.bctcHit,
      },
      result.meta,
    );
  } catch (error) {
    return fail(
      "VALUATION_SCREENER_ERROR",
      error instanceof Error ? error.message : "Không thể quét định giá",
      500,
    );
  }
}
