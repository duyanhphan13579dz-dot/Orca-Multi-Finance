import { safeApi } from "@/lib/safe-api";
import { getForexMarkets } from "@/lib/services/forex";
import { ensureCryptoForexRealtime } from "@/lib/realtime/crypto-forex-boot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

/**
 * GET /api/v1/forex/markets
 * Majors · crosses · VND · XAU/XAG · OIL — hard budget ≤15s, partial OK.
 */
export async function GET() {
  try {
    ensureCryptoForexRealtime();
  } catch {
    /* */
  }

  return safeApi({
    label: "forex-markets",
    guard: { wallMs: 14_000, maxSubrequests: 24, maxConcurrent: 3 },
    produce: async () => {
      const r = await getForexMarkets();
      if (!r?.data?.rows?.length) return null;
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
        },
      };
    },
    fallback: async () => ({
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
    }),
    unavailableSource: "forex",
    unavailableNote: "Forex tạm không khả dụng",
  });
}
