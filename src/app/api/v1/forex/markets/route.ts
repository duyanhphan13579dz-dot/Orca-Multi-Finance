import { safeApi } from "@/lib/safe-api";
import { getForexMarkets } from "@/lib/services/forex";
import { ensureCryptoForexRealtime } from "@/lib/realtime/crypto-forex-boot";
import { putHot, getHot } from "@/lib/hot-snapshot";
import { WORKERS_BUDGET } from "@/lib/data-engine/workers-budget";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** P8c: user path ≤15s */
export const maxDuration = 15;

export async function GET() {
  try {
    ensureCryptoForexRealtime();
  } catch {
    /* */
  }

  return safeApi({
    label: "forex-markets",
    guard: {
      wallMs: WORKERS_BUDGET.apiWallMs,
      maxSubrequests: WORKERS_BUDGET.maxSubrequestsPerRequest,
      maxConcurrent: WORKERS_BUDGET.maxParallelProviders,
    },
    produce: async () => {
      const fresh = await getHot<{ rows: unknown[]; usdStrengthNote?: string }>("forex");
      if (fresh?.fresh && Array.isArray(fresh.data?.rows) && fresh.data.rows.length) {
        return {
          data: fresh.data,
          meta: { ...fresh.meta, note: `hot-fresh forex · ${Math.round(fresh.ageMs / 1000)}s` },
          headers: {
            "Cache-Control": "private, max-age=8, stale-while-revalidate=45",
            "X-Orca-Hot": "fresh",
            "X-Orca-Mode": "hot",
          },
        };
      }
      const r = await getForexMarkets();
      if (!r?.data?.rows?.length) return null;
      putHot("forex", r.data, {
        source: r.meta?.source,
        partial: r.meta?.partial,
        note: r.meta?.note,
      });
      const metals = r.data.rows.filter((x) => x.group === "metal" || x.group === "energy").length;
      return {
        data: r.data,
        meta: {
          ...r.meta,
          note: r.meta.note ?? `FX board · ${r.data.rows.length} cặp · metals/oil ${metals}`,
        },
        headers: {
          "Cache-Control": r.meta.stale
            ? "private, max-age=8, stale-while-revalidate=90"
            : "private, max-age=15, stale-while-revalidate=60",
          "X-Orca-Mode": "live",
        },
      };
    },
    fallback: async () => {
      const snap = await getHot<{ rows: unknown[]; usdStrengthNote?: string }>("forex");
      if (snap?.data && Array.isArray(snap.data.rows) && snap.data.rows.length) {
        return {
          data: snap.data,
          meta: {
            ...snap.meta,
            note: `last-good forex · age ${Math.round(snap.ageMs / 1000)}s`,
            partial: true,
            stale: true,
          },
        };
      }
      return {
        data: {
          rows: [],
          usdStrengthNote: "Đang kết nối lại Biquote/Yahoo — thử refresh sau vài giây",
        },
        meta: {
          source: "forex-shell",
          partial: true,
          stale: true,
          note: "shell ≤15s",
        },
      };
    },
    unavailableSource: "forex",
    unavailableNote: "Forex tạm không khả dụng",
  });
}
