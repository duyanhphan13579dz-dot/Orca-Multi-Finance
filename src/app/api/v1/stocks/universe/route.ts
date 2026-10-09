import { ok, badRequest, fail } from "@/lib/envelope";
import { getVnFullUniverse, VN_EXCHANGES, type VnExchange } from "@/lib/services/vn-universe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/v1/stocks/universe?exchange=ALL|HOSE|HNX|UPCOM&limit=500&offset=0
 *
 * Full equity universe across 3 VN floors. OHLCV for any symbol:
 * GET /api/v1/chart/history?symbol=XXX&assetType=stock&timeframe=1d
 * or service getVnOhlcv(symbol).
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const rawEx = (url.searchParams.get("exchange") ?? "ALL").trim().toUpperCase();
    const exchange: VnExchange | "ALL" =
      rawEx === "ALL"
        ? "ALL"
        : (VN_EXCHANGES as readonly string[]).includes(rawEx)
          ? (rawEx as VnExchange)
          : ("INVALID" as never);

    if (rawEx !== "ALL" && !(VN_EXCHANGES as readonly string[]).includes(rawEx)) {
      return badRequest(`exchange phải là ALL | ${VN_EXCHANGES.join(" | ")}`);
    }

    const limit = Math.min(5000, Math.max(1, Number(url.searchParams.get("limit") ?? 500) || 500));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
    const q = (url.searchParams.get("q") ?? "").trim().toUpperCase();

    const universe = await getVnFullUniverse(exchange);
    let items = universe.items;
    if (q) {
      items = items.filter(
        (x) =>
          x.symbol.includes(q) ||
          (x.name ?? "").toUpperCase().includes(q) ||
          (x.industry ?? "").toUpperCase().includes(q),
      );
    }

    const sliced = items.slice(offset, offset + limit);

    return ok(
      {
        exchange: universe.exchange,
        counts: universe.counts,
        total: items.length,
        offset,
        limit,
        returned: sliced.length,
        items: sliced,
        ohlcv: {
          note: "Mọi mã trong universe lấy được OHLCV daily qua cascade vndirect-dchart ∥ stock_prices ∥ public(VPS/Entrade) ∥ ssi-fcdata",
          chart: "/api/v1/chart/history?symbol={SYMBOL}&assetType=stock&timeframe=1d&limit=260",
        },
      },
      universe.meta,
    );
  } catch (e) {
    console.error("[stocks/universe]", e);
    return fail("UNIVERSE_ERROR", e instanceof Error ? e.message : "failed", 500);
  }
}
