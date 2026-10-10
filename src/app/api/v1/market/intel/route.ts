import { buildMarketIntel } from "@/lib/services/market-intel";
import { getVnSession } from "@/lib/vn/sessions";
import { safeApi } from "@/lib/safe-api";
import { putHot, getHot } from "@/lib/hot-snapshot";
import { WORKERS_BUDGET } from "@/lib/data-engine/workers-budget";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** P8c: user path ≤15s */
export const maxDuration = 15;

/** MARKET INTELLIGENCE — last-good first, never hard-blank. */
export async function GET() {
  return safeApi({
    label: "market-intel",
    guard: {
      wallMs: WORKERS_BUDGET.apiWallMs,
      maxSubrequests: WORKERS_BUDGET.maxSubrequestsPerRequest,
      maxConcurrent: WORKERS_BUDGET.maxParallelProviders,
    },
    produce: async () => {
      const fresh = await getHot("intel");
      if (fresh?.fresh && fresh.data) {
        return {
          data: fresh.data,
          meta: {
            ...fresh.meta,
            note: `hot-fresh · ${Math.round(fresh.ageMs / 1000)}s`,
          },
          headers: {
            "Cache-Control": "private, max-age=8, stale-while-revalidate=45",
            "X-Orca-Hot": "fresh",
            "X-Orca-Mode": "hot",
          },
        };
      }

      const { intel, meta } = await buildMarketIntel();
      if (!intel) return null;
      putHot("intel", intel, {
        source: meta?.source ?? "intel",
        partial: meta?.partial,
        note: meta?.note,
      });
      return {
        data: intel,
        meta: meta ?? { source: "intel" },
        headers: {
          "Cache-Control": "private, max-age=12, stale-while-revalidate=60",
          "X-Orca-Mode": "live",
        },
      };
    },
    fallback: async () => {
      const snap = await getHot("intel");
      if (snap?.data) {
        return {
          data: snap.data,
          meta: {
            ...snap.meta,
            note: `last-good intel · age ${Math.round(snap.ageMs / 1000)}s`,
            partial: true,
            stale: true,
          },
        };
      }
      const session = getVnSession();
      return {
        data: {
          session,
          sessionHint: "Intel đang warm — thử lại sau vài giây",
          indices: null,
          indicesAvailable: false,
          breadth: { advancers: 0, decliners: 0, unchanged: 0, source: "shell", available: false },
          liquidity: { valueTraded: null, baseline: null, available: false, note: "shell" },
          flow: {
            foreignNet: null,
            propNet: null,
            etfNet: null,
            source: "shell",
            available: false,
            note: "shell",
          },
          crossAsset: [],
          condition: {
            rating: "NEUTRAL",
            score: 50,
            confidence: "LOW",
            components: [],
            drivers: [],
            risks: ["Intel shell"],
            crossAssetState: "NEUTRAL",
            coverage: 0,
          },
          contributors: { positive: [], negative: [], hasWeights: false, note: "shell" },
          news: [],
          sections: {
            indices: "UNAVAILABLE",
            breadth: "UNAVAILABLE",
            liquidity: "UNAVAILABLE",
            flow: "UNAVAILABLE",
            crossAsset: "UNAVAILABLE",
            news: "UNAVAILABLE",
          },
          vnDataNote: "Shell — cron intel-warm sẽ đổ đầy",
        },
        meta: { source: "intel-shell", partial: true, stale: true, note: "shell" },
      };
    },
    unavailableSource: "intel",
    unavailableNote: "Market intel tạm không khả dụng",
  });
}
