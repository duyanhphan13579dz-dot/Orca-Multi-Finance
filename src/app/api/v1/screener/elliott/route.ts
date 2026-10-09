import { screenElliott, type ElliottPattern } from "@/lib/services/elliott-screener";
import { safeApi } from "@/lib/safe-api";
import { WORKERS_BUDGET } from "@/lib/data-engine/workers-budget";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 25;

const PATTERNS = new Set<ElliottPattern>([
  "impulse-up",
  "impulse-down",
  "corrective-abc-up",
  "corrective-abc-down",
  "diagonal",
  "unclear",
]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = (url.searchParams.get("pattern") ?? "all").toLowerCase();
  const pattern =
    raw === "all" ? "all" : PATTERNS.has(raw as ElliottPattern) ? (raw as ElliottPattern) : "all";
  const symbols = (url.searchParams.get("symbols") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const minConfidence = Number(url.searchParams.get("minConfidence") ?? 25);

  return safeApi({
    label: "screener-elliott",
    guard: { wallMs: WORKERS_BUDGET.techScreenWallMs, maxSubrequests: 24, maxConcurrent: 3 },
    produce: async () => {
      const r = await screenElliott({
        symbols: symbols.length ? symbols : undefined,
        pattern,
        minConfidence: Number.isFinite(minConfidence) ? minConfidence : 25,
        sector: url.searchParams.get("sector") || undefined,
        limit: Math.min(Number(url.searchParams.get("limit") ?? 40) || 40, 60),
      });
      if (!r) return null;
      return {
        data: { universe: "elliott", rows: r.rows, scanned: r.scanned, skipped: r.skipped },
        meta: r.meta,
      };
    },
    fallback: async () => ({
      data: { universe: "elliott", rows: [], scanned: 0, skipped: 0 },
      meta: {
        source: "elliott-shell",
        partial: true,
        stale: true,
        note: "OHLCV tạm lỗi — thử lại sau",
      },
    }),
    unavailableSource: "elliott-screener",
    unavailableNote: "Elliott screener tạm không khả dụng",
  });
}
