import { ok, unavailable } from "@/lib/envelope";
import { getSectorTrendForSymbol, getSectorTrendSnapshot } from "@/lib/services/sector-trend";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/market/sector-trend
 *  - (no params) → xếp hạng xu hướng mọi ngành
 *  - ?sector=Ngân hàng → lọc một ngành
 *  - ?symbol=HPG → ngành của mã + hàng ngành tương ứng
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").trim().toUpperCase();
  const sector = (url.searchParams.get("sector") ?? "").trim();

  if (symbol) {
    const r = await getSectorTrendForSymbol(symbol);
    if (!r) {
      return unavailable("sector-trend", "Chưa có bảng giá để phân tích ngành.");
    }
    return ok(
      {
        symbol,
        sector: r.sector,
        row: r.row,
        leaders: r.snapshot.leaders,
        laggards: r.snapshot.laggards,
        marketAvgChangePercent: r.snapshot.marketAvgChangePercent,
        sessionDate: r.snapshot.sessionDate,
      },
      {
        source: r.meta.source,
        sourceTimestampMs: r.meta.sourceTimestamp ? Date.parse(r.meta.sourceTimestamp) : null,
        cached: r.meta.cached,
        stale: r.meta.stale,
        note: r.meta.note,
      },
    );
  }

  const snap = await getSectorTrendSnapshot(sector ? { sector } : undefined);
  if (!snap) {
    return unavailable("sector-trend", "Chưa kéo được bảng giá thị trường để xếp hạng ngành.");
  }

  return ok(
    {
      sessionDate: snap.snapshot.sessionDate,
      marketAvgChangePercent: snap.snapshot.marketAvgChangePercent,
      leaders: snap.snapshot.leaders,
      laggards: snap.snapshot.laggards,
      sectors: snap.snapshot.sectors,
      count: snap.snapshot.sectors.length,
    },
    {
      source: snap.meta.source,
      sourceTimestampMs: snap.meta.sourceTimestamp ? Date.parse(snap.meta.sourceTimestamp) : null,
      cached: snap.meta.cached,
      stale: snap.meta.stale,
      note: snap.meta.note,
    },
  );
}
