import { ok, unavailable } from "@/lib/envelope";
import { screenCanslim } from "@/lib/services/canslim-screener";
import type { CanslimLetter } from "@/lib/engines/canslim";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LETTERS = new Set<CanslimLetter>(["C", "A", "N", "S", "L", "I", "M"]);

/**
 * GET /api/v1/screener/canslim
 * Pipeline: quotes + OHLCV + BCTC + VNDirect ratios/equity + foreign flow + VNINDEX M.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const minScore = url.searchParams.get("minScore") != null ? Number(url.searchParams.get("minScore")) : 50;
  const minPass = url.searchParams.get("minPass") != null ? Number(url.searchParams.get("minPass")) : 0;
  const sector = url.searchParams.get("sector") || undefined;
  const symbols = (url.searchParams.get("symbols") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 40) || 40, 48);
  const requireLetters = (url.searchParams.get("letters") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is CanslimLetter => LETTERS.has(s as CanslimLetter));

  const r = await screenCanslim({
    symbols: symbols.length ? symbols : undefined,
    minScore: Number.isFinite(minScore) ? minScore : 50,
    minPass: Number.isFinite(minPass) ? minPass : 0,
    requireLetters: requireLetters.length ? requireLetters : undefined,
    sector,
    limit,
  });
  if (!r) {
    return unavailable("canslim-screener", "Chưa đủ nến/BCTC để quét CANSLIM — nguồn tạm lỗi.");
  }
  return ok(
    {
      universe: "canslim",
      rows: r.rows,
      scanned: r.scanned,
      skipped: r.skipped,
      marketBullish: r.marketBullish,
      marketDetail: r.marketDetail,
      coverage: r.coverage,
    },
    r.meta,
  );
}
