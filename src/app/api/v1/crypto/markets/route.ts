import { safeApi } from "@/lib/safe-api";
import { getCryptoMarkets } from "@/lib/services/crypto";
import { getHot, putHot } from "@/lib/hot-snapshot";
import { buildMeta } from "@/lib/freshness";
import { WORKERS_BUDGET } from "@/lib/data-engine/workers-budget";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** P8c: user path ≤15s */
export const maxDuration = 15;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 60) || 60, 300);
  const sort = url.searchParams.get("sort");
  const defaultScan = !sort && limit >= 60;

  return safeApi({
    label: "crypto-markets",
    guard: {
      wallMs: WORKERS_BUDGET.apiWallMs,
      maxSubrequests: WORKERS_BUDGET.maxSubrequestsPerRequest,
      maxConcurrent: WORKERS_BUDGET.maxParallelProviders,
    },
    produce: async () => {
      // P8b: snapshot-first on default scan
      if (defaultScan) {
        const fresh = await getHot<{
          rows: unknown[];
          summary: {
            marketCount: number;
            advancers: number;
            decliners: number;
            avgChangePercent: number;
            totalQuoteVolume: number;
            btcChangePercent: number | null;
            ethChangePercent: number | null;
            fetchedAt: string;
          };
        }>("crypto");
        if (fresh?.fresh && Array.isArray(fresh.data?.rows) && fresh.data.rows.length) {
          return {
            data: {
              rows: (fresh.data.rows as unknown[]).slice(0, limit),
              summary: fresh.data.summary,
            },
            meta: {
              ...fresh.meta,
              note: `hot-fresh crypto · ${Math.round(fresh.ageMs / 1000)}s`,
            },
            headers: {
              "Cache-Control": "private, max-age=8, stale-while-revalidate=40",
              "X-Orca-Hot": "fresh",
              "X-Orca-Mode": "hot",
            },
          };
        }
      }

      const r = await getCryptoMarkets();
      if (!r?.rows?.length) return null;
      let rows = r.rows;
      if (sort === "gainers") {
        rows = [...rows].sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));
      } else if (sort === "losers") {
        rows = [...rows].sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0));
      }
      const data = { rows: rows.slice(0, limit), summary: r.summary };
      if (defaultScan) putHot("crypto", data, r.meta);
      return {
        data,
        meta: r.meta,
        headers: {
          "Cache-Control": r.meta.stale
            ? "private, max-age=8, stale-while-revalidate=60"
            : "private, max-age=10, stale-while-revalidate=40",
          "X-Orca-Mode": "live",
        },
      };
    },
    fallback: async () => {
      const last = await getHot<{
        rows: unknown[];
        summary: {
          marketCount: number;
          advancers: number;
          decliners: number;
          avgChangePercent: number;
          totalQuoteVolume: number;
          btcChangePercent: number | null;
          ethChangePercent: number | null;
          fetchedAt: string;
        };
      }>("crypto");
      if (last) {
        return {
          data: last.data,
          meta: buildMeta({
            source: "crypto-last-good",
            cached: true,
            partial: true,
            stale: true,
            note: `Phục vụ last-good crypto · age ${Math.round(last.ageMs / 1000)}s`,
          }),
        };
      }
      return {
        data: {
          rows: [],
          summary: {
            marketCount: 0,
            advancers: 0,
            decliners: 0,
            avgChangePercent: 0,
            totalQuoteVolume: 0,
            btcChangePercent: null,
            ethChangePercent: null,
            fetchedAt: new Date().toISOString(),
          },
        },
        meta: {
          source: "crypto-shell",
          partial: true,
          stale: true,
          note: "Crypto markets tạm trống — đang kết nối lại",
        },
      };
    },
    unavailableSource: "crypto",
    unavailableNote: "Crypto market data không khả dụng — thử lại sau.",
  });
}
