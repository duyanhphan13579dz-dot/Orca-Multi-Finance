import { ok, fail } from "@/lib/envelope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/market/global
 * US (Polygon) + crypto (CoinGecko) + Asia (Yahoo) + VN liquidity volume spark (ohlcv).
 */

const ASIA_YAHOO: { yahoo: string; key: string; label: string }[] = [
  { yahoo: "^N225", key: "N225", label: "Nikkei 225" },
  { yahoo: "^HSI", key: "HSI", label: "Hang Seng" },
  { yahoo: "000001.SS", key: "SSEC", label: "Shanghai" },
  { yahoo: "^KS11", key: "KOSPI", label: "KOSPI" },
];

export async function GET() {
  try {
    const sources: string[] = [];
    let us: unknown[] = [];
    let crypto: unknown[] = [];
    let asia: {
      symbol: string;
      label: string;
      price: number;
      changePercent: number | null;
    }[] = [];
    let liquiditySpark: {
      volumes: number[];
      times: (string | null)[];
      source: string;
      symbol: string;
    } | null = null;
    const errors: string[] = [];

    const jobs: Promise<void>[] = [];

    jobs.push(
      (async () => {
        try {
          const { getPolygonIndexSnapshots } = await import("@/lib/providers/polygon");
          const poly = await getPolygonIndexSnapshots(["SPY", "QQQ", "DIA", "IWM"]);
          us = poly.rows;
          sources.push("polygon");
        } catch (e) {
          errors.push(e instanceof Error ? e.message : "polygon failed");
        }
      })(),
    );

    jobs.push(
      (async () => {
        try {
          const { getCoinGeckoSimplePrices } = await import("@/lib/providers/coingecko");
          const cg = await getCoinGeckoSimplePrices();
          crypto = cg.rows.slice(0, 10);
          sources.push(`coingecko:${cg.via}`);
        } catch (e) {
          errors.push(e instanceof Error ? e.message : "coingecko failed");
        }
      })(),
    );

    jobs.push(
      (async () => {
        try {
          const { getYahooQuotes } = await import("@/lib/providers/yahoo");
          const map = await getYahooQuotes(ASIA_YAHOO.map((a) => a.yahoo));
          for (const a of ASIA_YAHOO) {
            const q = map.get(a.yahoo);
            if (!q || !Number.isFinite(q.price)) continue;
            asia.push({
              symbol: a.key,
              label: a.label,
              price: q.price,
              changePercent: q.changePercent,
            });
          }
          if (asia.length) sources.push("yahoo-asia");
        } catch (e) {
          errors.push(e instanceof Error ? e.message : "yahoo asia failed");
        }
      })(),
    );

    jobs.push(
      (async () => {
        try {
          const { getVnOhlcv } = await import("@/lib/services/stocks");
          const pack = await getVnOhlcv("VNINDEX", 20);
          const bars = pack?.bars ?? [];
          const withVol = bars.filter((b) => b.volume != null && b.volume > 0);
          if (withVol.length >= 4) {
            const slice = withVol.slice(-12);
            liquiditySpark = {
              volumes: slice.map((b) => Number(b.volume) || 0),
              times: slice.map((b) =>
                b.time ? new Date(b.time).toISOString().slice(0, 10) : null,
              ),
              source: pack?.meta?.source ?? "vn-ohlcv",
              symbol: "VNINDEX",
            };
            sources.push(`liq:${liquiditySpark.source}`);
            return;
          }
        } catch (e) {
          errors.push(e instanceof Error ? e.message : "vn ohlcv spark failed");
        }
        try {
          const { getChartHistory } = await import("@/lib/services/chart");
          const r = await getChartHistory({
            symbol: "VNINDEX",
            assetType: "stock",
            timeframe: "1d",
            limit: 20,
          });
          const candles = r?.data?.candles ?? [];
          const withVol = candles.filter((c) => (c.volume ?? 0) > 0);
          if (withVol.length >= 4) {
            const slice = withVol.slice(-12);
            liquiditySpark = {
              volumes: slice.map((c) => Number(c.volume) || 0),
              times: slice.map((c) =>
                c.time ? new Date(c.time).toISOString().slice(0, 10) : null,
              ),
              source: r?.meta?.source ?? "chart-history",
              symbol: "VNINDEX",
            };
            sources.push(`liq:${liquiditySpark.source}`);
          }
        } catch (e) {
          errors.push(e instanceof Error ? e.message : "chart spark failed");
        }
      })(),
    );

    await Promise.all(jobs);

    if (!us.length && !crypto.length && !asia.length) {
      return fail("GLOBAL_MARKET_UNAVAILABLE", errors.join("; ") || "no providers", 502);
    }

    return ok(
      {
        us,
        crypto,
        asia,
        liquiditySpark,
        sources,
        at: new Date().toISOString(),
      },
      {
        source: sources.join("+") || "none",
        sourceTimestampMs: Date.now(),
        partial: errors.length > 0 || !asia.length || !liquiditySpark,
        note: errors.length ? errors.join("; ") : undefined,
      },
    );
  } catch (e) {
    return fail("GLOBAL_MARKET_FAILED", e instanceof Error ? e.message : "unknown", 502);
  }
}
