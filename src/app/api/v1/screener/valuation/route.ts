import { screenValuation } from "@/lib/services/valuation-screener";
import { safeApi } from "@/lib/safe-api";
import { WORKERS_BUDGET } from "@/lib/data-engine/workers-budget";
import { getHot, putHot } from "@/lib/hot-snapshot";
import { buildMeta } from "@/lib/freshness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

function num(v: string | null): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbols = url.searchParams.get("symbols")?.split(/[,\s;]+/).filter(Boolean);
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
    minDividendYield: num(url.searchParams.get("minDividendYield")),
    maxDividendYield: num(url.searchParams.get("maxDividendYield")),
    minMarketCap: num(url.searchParams.get("minMarketCap")),
    maxMarketCap: num(url.searchParams.get("maxMarketCap")),
    minPrice: num(url.searchParams.get("minPrice")),
    maxPrice: num(url.searchParams.get("maxPrice")),
    limit: num(url.searchParams.get("limit")),
  };

  return safeApi({
    label: "screener-valuation",
    guard: {
      wallMs: WORKERS_BUDGET.techScreenWallMs,
      maxSubrequests: 26,
      maxConcurrent: 2,
    },
    produce: async () => {
      const result = await screenValuation(filters);
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
      if (defaultScan) putHot("screener-valuation", response.data, response.meta);
      return response;
    },
    fallback: async () => {
      if (defaultScan) {
        const last = await getHot<{
          rows: unknown[];
          scanned: number;
          skipped: number;
          withData: number;
        }>("screener-valuation");
        if (last) {
          return {
            data: last.data,
            meta: buildMeta({
              source: "valuation-last-good",
              cached: true,
              partial: true,
              stale: true,
              note: `Phục vụ last-good Valuation · age ${Math.round(last.ageMs / 1000)}s`,
            }),
          };
        }
      }
      return {
        data: { rows: [], scanned: 0, skipped: 0, withData: 0 },
        meta: {
          source: "valuation-shell",
          partial: true,
          stale: true,
          note: "Valuation screener tạm trống — đang phục hồi",
        },
      };
    },
    unavailableSource: "valuation-screener",
    unavailableNote: "Không thể quét định giá",
  });
}
