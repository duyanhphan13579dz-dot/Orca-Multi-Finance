import { badRequest } from "@/lib/envelope";
import { screenMinervini } from "@/lib/services/minervini-screener";
import { safeApi } from "@/lib/safe-api";
import { WORKERS_BUDGET } from "@/lib/data-engine/workers-budget";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 25;

/** GET /api/v1/screener/minervini — Mark Minervini Trend Template */
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

  return safeApi({
    label: "screener-minervini",
    guard: { wallMs: WORKERS_BUDGET.techScreenWallMs, maxSubrequests: 24, maxConcurrent: 3 },
    produce: async () => {
      const r = await screenMinervini({
        symbols,
        minPass: Math.min(8, Math.max(0, Math.floor(minPass))),
        onlyPassAll,
        minRs: Number.isFinite(minRs) ? minRs : 0,
        sector,
        limit: Number.isFinite(limit) ? Math.min(80, Math.max(1, limit)) : 40,
      });
      if (!r) return null;
      return {
        data: { rows: r.rows, scanned: r.scanned, skipped: r.skipped },
        meta: r.meta,
      };
    },
    fallback: async () => ({
      data: { rows: [], scanned: 0, skipped: 0 },
      meta: {
        source: "minervini-shell",
        partial: true,
        stale: true,
        note: "OHLCV tạm lỗi — thử lại sau",
      },
    }),
    unavailableSource: "minervini-screener",
    unavailableNote: "Minervini screener tạm không khả dụng",
  });
}
