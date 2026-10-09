import { screenCanslim } from "@/lib/services/canslim-screener";
import type { CanslimLetter } from "@/lib/engines/canslim";
import { safeApi } from "@/lib/safe-api";
import { WORKERS_BUDGET } from "@/lib/data-engine/workers-budget";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const LETTERS = new Set<CanslimLetter>(["C", "A", "N", "S", "L", "I", "M"]);

const EMPTY_COVERAGE = {
  withBars: 0,
  withGrowth: 0,
  withHealth: 0,
  withForeign: 0,
  withRatios: 0,
  withEquity: 0,
};

/** GET /api/v1/screener/canslim — realtime-first */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const minScore =
    url.searchParams.get("minScore") != null ? Number(url.searchParams.get("minScore")) : 40;
  const minPass =
    url.searchParams.get("minPass") != null ? Number(url.searchParams.get("minPass")) : 0;
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
  const phaseRaw = (url.searchParams.get("phase") ?? "auto").toLowerCase();
  const phase =
    phaseRaw === "tech" || phaseRaw === "full" ? (phaseRaw as "tech" | "full") : ("auto" as const);

  return safeApi({
    label: "screener-canslim",
    guard: {
      wallMs: WORKERS_BUDGET.techScreenWallMs,
      maxSubrequests: 26,
      maxConcurrent: 3,
    },
    produce: async () => {
      const payload = await screenCanslim({
        symbols: symbols.length ? symbols : undefined,
        minScore: Number.isFinite(minScore) ? minScore : 40,
        minPass: Number.isFinite(minPass) ? minPass : 0,
        requireLetters: requireLetters.length ? requireLetters : undefined,
        sector,
        limit,
        phase,
      });
      if (!payload) return null;
      return {
        data: {
          universe: "canslim",
          phase: payload.phase,
          rows: payload.rows,
          scanned: payload.scanned,
          skipped: payload.skipped,
          marketBullish: payload.marketBullish,
          marketDetail: payload.marketDetail,
          coverage: payload.coverage,
        },
        meta: payload.meta,
      };
    },
    fallback: async () => ({
      data: {
        universe: "canslim",
        phase: "tech" as const,
        rows: [],
        scanned: 0,
        skipped: 0,
        marketBullish: null,
        marketDetail: "OHLCV tạm lỗi",
        coverage: EMPTY_COVERAGE,
      },
      meta: {
        source: "canslim-shell",
        partial: true,
        stale: true,
        note: "CANSLIM tạm trống — thử lại hoặc chọn ít mã hơn",
      },
    }),
    unavailableSource: "canslim-screener",
    unavailableNote: "CANSLIM tạm không khả dụng",
  });
}
