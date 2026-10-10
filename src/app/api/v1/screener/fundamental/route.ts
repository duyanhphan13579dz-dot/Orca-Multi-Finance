import { screenFundamental, type FundamentalScreenRow } from "@/lib/services/fundamental-screener";
import { safeApi } from "@/lib/safe-api";
import { WORKERS_BUDGET } from "@/lib/data-engine/workers-budget";
import { getHot, putHot } from "@/lib/hot-snapshot";
import { buildMeta } from "@/lib/freshness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** P8c: screener user ≤18s; default scan prefers hot */
export const maxDuration = 18;

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
  const symbols = url.searchParams.get("symbols")?.split(/[ ,\s;]+/).filter(Boolean);
  const sector = url.searchParams.get("sector") ?? undefined;
  const exchange = url.searchParams.get("exchange") ?? undefined;
  const defaultScan =
    !symbols?.length &&
    !sector &&
    !exchange &&
    [...url.searchParams.keys()].every((key) => key === "_");

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
    requirePositiveFcf:
      flag(url.searchParams.get("requirePositiveFcf")) ?? flag(url.searchParams.get("minFcf")),
    minPrice: num(url.searchParams.get("minPrice")),
    maxPrice: num(url.searchParams.get("maxPrice")),
    limit: num(url.searchParams.get("limit")),
  };

  return safeApi({
    label: "screener-fundamental",
    guard: {
      wallMs: WORKERS_BUDGET.techScreenWallMs,
      maxSubrequests: 20,
      maxConcurrent: WORKERS_BUDGET.maxParallelProviders,
    },
    produce: async () => {
      // P8b: default scan → hot first
      if (defaultScan) {
        const fresh = await getHot<{
          rows: FundamentalScreenRow[];
          scanned: number;
          skipped: number;
          withData: number;
        }>("screener-fundamental");
        if (fresh?.fresh && fresh.data?.rows?.length) {
          return {
            data: fresh.data,
            meta: {
              ...fresh.meta,
              note: `hot-fresh fundamental · ${Math.round(fresh.ageMs / 1000)}s`,
            },
            headers: {
              "Cache-Control": "private, max-age=30, stale-while-revalidate=120",
              "X-Orca-Hot": "fresh",
              "X-Orca-Mode": "hot",
            },
          };
        }
      }

      const result = await screenFundamental(filters);
      if (!result) return null;
      const response = {
        data: {
          rows: result.rows,
          scanned: result.scanned,
          skipped: result.skipped,
          withData: result.withData,
        },
        meta: result.meta,
      };
      if (defaultScan) putHot("screener-fundamental", response.data, response.meta);
      return {
        ...response,
        headers: {
          "Cache-Control": "private, max-age=20, stale-while-revalidate=90",
          "X-Orca-Mode": "live",
        },
      };
    },
    fallback: async () => {
      if (defaultScan) {
        const last = await getHot<{
          rows: FundamentalScreenRow[];
          scanned: number;
          skipped: number;
          withData: number;
        }>("screener-fundamental");
        if (last)
          return {
            data: last.data,
            meta: buildMeta({
              source: "fundamental-last-good",
              cached: true,
              partial: true,
              stale: true,
              note: "Phục vụ last-good Fundamental snapshot trong khi nguồn đang phục hồi",
            }),
          };
      }
      return {
        data: { rows: [] as FundamentalScreenRow[], scanned: 0, skipped: 0, withData: 0 },
        meta: buildMeta({
          source: "fundamental-shell",
          partial: true,
          stale: true,
          note: "Fundamental screener tạm trống — đang phục hồi",
        }),
      };
    },
    unavailableSource: "fundamental-screener",
    unavailableNote: "Không thể quét fundamental",
  });
}
