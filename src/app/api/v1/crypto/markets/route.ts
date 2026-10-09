import { safeApi } from "@/lib/safe-api";
import { getCryptoMarkets } from "@/lib/services/crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 60) || 60, 300);
  const sort = url.searchParams.get("sort");

  return safeApi({
    label: "crypto-markets",
    guard: { wallMs: 12_000, maxSubrequests: 18, maxConcurrent: 2 },
    produce: async () => {
      const r = await getCryptoMarkets();
      if (!r?.rows?.length) return null;
      let rows = r.rows;
      if (sort === "gainers") {
        rows = [...rows].sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));
      } else if (sort === "losers") {
        rows = [...rows].sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0));
      }
      return {
        data: { rows: rows.slice(0, limit), summary: r.summary },
        meta: r.meta,
        headers: {
          "Cache-Control": r.meta.stale
            ? "private, max-age=8, stale-while-revalidate=60"
            : "private, max-age=10, stale-while-revalidate=40",
        },
      };
    },
    fallback: async () => ({
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
    }),
    unavailableSource: "crypto",
    unavailableNote: "Crypto market data không khả dụng — thử lại sau.",
  });
}
