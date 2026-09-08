import { ok, unavailable } from "@/lib/envelope";
import { getVnMarketBoard } from "@/lib/services/stocks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Warm full VN market board cache (indices + all quotes + universe). */
export async function GET() {
  const t0 = Date.now();
  const market = await getVnMarketBoard();
  if (!market) {
    return unavailable("vn-cron-stocks", "Không refresh được bảng giá VN.");
  }
  return ok({
    ok: true,
    sessionDate: market.sessionDate,
    quotes: market.quotes.length,
    indices: market.indices.length,
    universe: market.universe.length,
    durationMs: Date.now() - t0,
    source: market.meta.source,
  });
}
