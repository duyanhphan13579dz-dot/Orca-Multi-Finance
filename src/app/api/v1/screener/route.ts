import { ok, unavailable } from "@/lib/envelope";
import { screenCrypto } from "@/lib/services/crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Multi-asset screener. Crypto universe is screened against live Binance data.
 * VN equity screening activates automatically when VNStock is configured.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const universe = url.searchParams.get("universe") ?? "crypto";
  if (universe === "crypto") {
    const num = (k: string) => (url.searchParams.get(k) != null ? Number(url.searchParams.get(k)) : undefined);
    const sort = url.searchParams.get("sort");
    const r = await screenCrypto({
      minChange: num("minChange"),
      maxChange: num("maxChange"),
      minQuoteVolume: num("minQuoteVolume"),
      limit: Math.min(num("limit") ?? 40, 100),
      sort: sort === "gainers" || sort === "losers" ? sort : "volume",
    });
    if (!r) return unavailable("binance", "Binance không khả dụng — screener tạm dừng.");
    return ok({ universe, rows: r.rows }, r.meta);
  }
  return unavailable("vnstock", "Screener cổ phiếu Việt Nam cần VNSTOCK_API_KEY — hiện tại UNAVAILABLE (không mock data).");
}
