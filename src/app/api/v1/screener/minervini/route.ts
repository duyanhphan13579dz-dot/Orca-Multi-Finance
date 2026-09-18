import { ok, unavailable, badRequest } from "@/lib/envelope";
import { screenMinervini } from "@/lib/services/minervini-screener";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/screener/minervini
 * Mark Minervini Trend Template (8 criteria, Stage 2 filter).
 *
 * Query:
 *   symbols=VCB,FPT   — optional subset
 *   minPass=6         — minimum criteria passed (default 6; use 8 for strict)
 *   onlyPassAll=1     — only 8/8 Stage-2 names
 *   minRs=70          — minimum RS proxy
 *   sector=Ngân hàng
 *   limit=40
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbolsRaw = url.searchParams.get("symbols");
  const symbols = symbolsRaw
    ? symbolsRaw
        .split(/[\s,;]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    : undefined;
  const minPass = Number(url.searchParams.get("minPass") ?? "6");
  const onlyPassAll =
    url.searchParams.get("onlyPassAll") === "1" || url.searchParams.get("onlyPassAll") === "true";
  const minRs = Number(url.searchParams.get("minRs") ?? "0");
  const sector = url.searchParams.get("sector")?.trim() || undefined;
  const limit = Number(url.searchParams.get("limit") ?? "40");

  if (Number.isNaN(minPass) || minPass < 0 || minPass > 8) {
    return badRequest("minPass must be 0–8");
  }

  const r = await screenMinervini({
    symbols,
    minPass: Math.min(8, Math.max(0, Math.floor(minPass))),
    onlyPassAll,
    minRs: Number.isFinite(minRs) ? minRs : 0,
    sector,
    limit: Number.isFinite(limit) ? Math.min(80, Math.max(1, limit)) : 40,
  });

  if (!r) {
    return unavailable("minervini-screener", "Chưa đủ nến OHLCV để quét Trend Template — nguồn lịch sử tạm lỗi.");
  }

  return ok(
    {
      rows: r.rows,
      scanned: r.scanned,
      skipped: r.skipped,
    },
    r.meta,
  );
}
