import { screenCrypto } from "@/lib/services/crypto";
import { safeApi } from "@/lib/safe-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

/**
 * Multi-asset screener. Crypto universe is screened against live Binance data.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const universe = url.searchParams.get("universe") ?? "crypto";

  if (universe !== "crypto") {
    return safeApi({
      label: "screener-vn",
      produce: async () => null,
      fallback: async () => ({
        data: { universe, rows: [] },
        meta: {
          source: "vnstock-shell",
          partial: true,
          note: "Dùng /api/v1/screener/fundamental|valuation|candlestick… cho cổ phiếu VN",
        },
      }),
      unavailableSource: "vnstock",
      unavailableNote:
        "Screener cổ phiếu Việt Nam: dùng các endpoint /api/v1/screener/* chuyên biệt.",
    });
  }

  const num = (k: string) =>
    url.searchParams.get(k) != null ? Number(url.searchParams.get(k)) : undefined;
  const sort = url.searchParams.get("sort");

  return safeApi({
    label: "screener-crypto",
    guard: { wallMs: 12_000, maxSubrequests: 16, maxConcurrent: 2 },
    produce: async () => {
      const r = await screenCrypto({
        minChange: num("minChange"),
        maxChange: num("maxChange"),
        minQuoteVolume: num("minQuoteVolume"),
        limit: Math.min(num("limit") ?? 40, 100),
        sort: sort === "gainers" || sort === "losers" ? sort : "volume",
      });
      if (!r) return null;
      return { data: { universe, rows: r.rows }, meta: r.meta };
    },
    fallback: async () => ({
      data: { universe, rows: [] },
      meta: {
        source: "crypto-shell",
        partial: true,
        stale: true,
        note: "Binance tạm lỗi — thử lại sau",
      },
    }),
    unavailableSource: "binance",
    unavailableNote: "Binance không khả dụng — screener tạm dừng.",
  });
}
