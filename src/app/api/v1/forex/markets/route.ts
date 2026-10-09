import { safeApi } from "@/lib/safe-api";
import { getForexMarkets } from "@/lib/services/forex";
import { ensureCryptoForexRealtime } from "@/lib/realtime/crypto-forex-boot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 25;

/**
 * GET /api/v1/forex/markets
 * Majors · crosses · VND · XAU/XAG · OIL/UKOIL · metals
 */
export async function GET() {
  try {
    ensureCryptoForexRealtime();
  } catch {
    /* */
  }

  return safeApi({
    label: "forex-markets",
    guard: { wallMs: 16_000, maxSubrequests: 28, maxConcurrent: 4 },
    produce: async () => {
      const r = await getForexMarkets();
      if (!r?.data?.rows?.length) return null;
      return {
        data: r.data,
        meta: r.meta,
        headers: {
          "Cache-Control": r.meta.stale
            ? "private, max-age=5, stale-while-revalidate=45"
            : "private, max-age=8, stale-while-revalidate=30",
        },
      };
    },
    fallback: async () => ({
      data: {
        rows: [],
        usdStrengthNote: "Forex/metals tạm trống — đang kết nối Biquote/Yahoo lại",
      },
      meta: {
        source: "forex-shell",
        partial: true,
        stale: true,
        note: "shell",
      },
    }),
    unavailableSource: "forex",
    unavailableNote: "Forex + metals + oil không khả dụng",
  });
}
