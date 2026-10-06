import { ok } from "@/lib/envelope";
import { getMarginSchedule, getContractMarginEstimate } from "@/lib/services/derivatives";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/derivatives/margin?productId=VN30_INDEX_FUT
 * GET /api/v1/derivatives/margin?symbol=VN30F1M&last=1300
 * Indicative VSDC margin schedule (versioned seed) — not live clearing rates.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol");
  const productId = url.searchParams.get("productId");
  const lastParam = url.searchParams.get("last");
  const last = lastParam != null ? Number(lastParam) : null;

  if (symbol) {
    const est = getContractMarginEstimate(symbol, Number.isFinite(last as number) ? last : null);
    return ok(
      {
        estimate: est,
        note: "Indicative seed from VSDC notices — verify before risk use",
      },
      {
        source: "vsdc-spec",
        sourceTimestamp: new Date().toISOString(),
        ingestedAt: new Date().toISOString(),
        freshness: "FRESH" as const,
        ageMs: 0,
        cached: false,
        stale: false,
        partial: est?.initialMargin == null,
        note: est?.entry?.note,
      },
    );
  }

  const schedule = getMarginSchedule(productId ?? undefined);
  return ok(
    { schedule, note: "Indicative margin schedule (P2) — effectiveFrom versioned" },
    {
      source: "vsdc-spec",
      sourceTimestamp: new Date().toISOString(),
      ingestedAt: new Date().toISOString(),
      freshness: "FRESH" as const,
      ageMs: 0,
      cached: false,
      stale: false,
      partial: schedule.some((s) => s.initialMarginRate == null),
    },
  );
}
