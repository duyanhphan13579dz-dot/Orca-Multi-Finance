import { ok, unavailable } from "@/lib/envelope";
import { screenCrypto } from "@/lib/services/crypto";
import { screenVnStocks } from "@/lib/services/stocks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Multi-asset screener.
 *  - universe=crypto → live Binance spot (default)
 *  - universe=vn     → VNStock universe + quotes (needs VNSTOCK_API_KEY),
 *                      optional filters: exchange=HOSE|HNX|UPCOM, sector=<taxonomy>
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const universe = url.searchParams.get("universe") ?? "crypto";
  const num = (k: string) => (url.searchParams.get(k) != null ? Number(url.searchParams.get(k)) : undefined);

  if (universe === "crypto") {
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

  if (universe === "vn") {
    const exchange = url.searchParams.get("exchange");
    const sector = url.searchParams.get("sector");
    const symbolsParam = url.searchParams.get("symbols");
    const r = await screenVnStocks({
      minChange: num("minChange"),
      maxChange: num("maxChange"),
      minQuoteVolume: num("minQuoteVolume"),
      limit: Math.min(num("limit") ?? 40, 100),
      sort: (url.searchParams.get("sort") === "gainers" || url.searchParams.get("sort") === "losers" ? url.searchParams.get("sort") : "volume") as "gainers" | "losers" | "volume",
      exchange: exchange === "HOSE" || exchange === "HNX" || exchange === "UPCOM" ? exchange : undefined,
      sector: sector?.trim() || undefined,
      symbols: symbolsParam?.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
    });
    if (!r) return unavailable("vnstock", "Screener cổ phiếu Việt Nam cần VNSTOCK_API_KEY — hiện tại UNAVAILABLE (không mock data).");
    return ok({ universe, rows: r.rows, note: r.note }, r.meta);
  }

  return unavailable("screener", `Universe không hợp lệ: ${universe} (hỗ trợ crypto|vn).`);
}
