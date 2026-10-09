import { screenFundamental } from "@/lib/services/fundamental-screener";
import { safeApi } from "@/lib/safe-api";
import { WORKERS_BUDGET } from "@/lib/data-engine/workers-budget";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

function num(v: string | null): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function flag(v: string | null): boolean | undefined {
  if (v == null || v === "") return undefined;
  return v === "1" || v.toLowerCase() === "true" || v === "yes";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbols = url.searchParams.get("symbols")?.split(/[,\s;]+/).filter(Boolean);
  const sector = url.searchParams.get("sector") ?? undefined;
  const exchange = url.searchParams.get("exchange") ?? undefined;

  const filters = {
    symbols,
    sector: sector || undefined,
    exchange: exchange || undefined,
    minRoe: num(url.searchParams.get("minRoe")),
    maxRoe: num(url.searchParams.get("maxRoe")),
    minRoa: num(url.searchParams.get("minRoa")),
    maxRoa: num(url.searchParams.get("maxRoa")),
    minRos: num(url.searchParams.get("minRos")),
    maxRos: num(url.searchParams.get("maxRos")),
    minRoic: num(url.searchParams.get("minRoic")),
    maxRoic: num(url.searchParams.get("maxRoic")),
    minGrossMargin: num(url.searchParams.get("minGrossMargin")),
    maxGrossMargin: num(url.searchParams.get("maxGrossMargin")),
    minNetMargin: num(url.searchParams.get("minNetMargin")),
    maxNetMargin: num(url.searchParams.get("maxNetMargin")),
    minOperatingMargin: num(url.searchParams.get("minOperatingMargin")),
    maxOperatingMargin: num(url.searchParams.get("maxOperatingMargin")),
    minDebtEquity: num(url.searchParams.get("minDebtEquity")),
    maxDebtEquity: num(url.searchParams.get("maxDebtEquity")),
    minCurrentRatio: num(url.searchParams.get("minCurrentRatio")),
    maxCurrentRatio: num(url.searchParams.get("maxCurrentRatio")),
    minCoverage: num(url.searchParams.get("minCoverage")),
    minHealthScore: num(url.searchParams.get("minHealthScore")),
    minQualityScore: num(url.searchParams.get("minQualityScore")),
    minNiYoy: num(url.searchParams.get("minNiYoy")),
    maxNiYoy: num(url.searchParams.get("maxNiYoy")),
    minRevenueYoy: num(url.searchParams.get("minRevenueYoy")),
    maxRevenueYoy: num(url.searchParams.get("maxRevenueYoy")),
    maxNetDebtEbitda: num(url.searchParams.get("maxNetDebtEbitda")),
    requirePositiveFcf: flag(url.searchParams.get("requirePositiveFcf")) ?? flag(url.searchParams.get("minFcf")),
    minPrice: num(url.searchParams.get("minPrice")),
    maxPrice: num(url.searchParams.get("maxPrice")),
    limit: num(url.searchParams.get("limit")),
  };

  return safeApi({
    label: "screener-fundamental",
    guard: {
      wallMs: WORKERS_BUDGET.techScreenWallMs,
      maxSubrequests: 26,
      maxConcurrent: 2,
    },
    produce: async () => {
      const result = await screenFundamental(filters);
      if (!result) return null;
      return {
        data: {
          rows: result.rows,
          scanned: result.scanned,
          skipped: result.skipped,
          withData: result.withData,
        },
        meta: result.meta,
      };
    },
    fallback: async () => ({
      data: { rows: [], scanned: 0, skipped: 0, withData: 0 },
      meta: {
        source: "fundamental-shell",
        partial: true,
        stale: true,
        note: "Fundamental screener tạm trống — đang phục hồi",
      },
    }),
    unavailableSource: "fundamental-screener",
    unavailableNote: "Không thể quét fundamental",
  });
}
