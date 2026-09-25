/**
 * Market snapshot — VN session + optional global pulse (Polygon US, crypto tip).
 */

import { getVnSession, sessionFreshnessHint, type VnSessionInfo } from "@/lib/vn/sessions";
import { buildMeta } from "@/lib/freshness";
import type { Meta } from "@/lib/types";

export type GlobalPulseRow = {
  symbol: string;
  price: number;
  changePercent: number | null;
  source: string;
};

export type MarketSnapshot = {
  vnSession: VnSessionInfo;
  vnSessionHint: string;
  checkedAt: string;
  global?: {
    us: GlobalPulseRow[];
    cryptoTip: GlobalPulseRow[];
    sources: string[];
  };
};

export async function buildMarketSnapshot(): Promise<{
  snapshot: MarketSnapshot;
  meta: Meta;
}> {
  const vnSession = getVnSession();
  const checkedAt = new Date().toISOString();
  const sources: string[] = ["vn-session"];
  let us: GlobalPulseRow[] = [];
  let cryptoTip: GlobalPulseRow[] = [];

  try {
    const { getPolygonIndexSnapshots } = await import("@/lib/providers/polygon");
    const poly = await getPolygonIndexSnapshots(["SPY", "QQQ", "DIA"]);
    us = poly.rows.map((r) => ({
      symbol: r.symbol,
      price: r.price,
      changePercent: r.changePercent,
      source: "polygon",
    }));
    sources.push("polygon");
  } catch {
    /* optional */
  }

  try {
    const { getCoinGeckoSimplePrices } = await import("@/lib/providers/coingecko");
    const cg = await getCoinGeckoSimplePrices();
    cryptoTip = cg.rows
      .filter((r) => r.symbol === "BTCUSDT" || r.symbol === "ETHUSDT")
      .map((r) => ({
        symbol: r.baseAsset,
        price: r.price,
        changePercent: r.changePercent,
        source: "coingecko",
      }));
    if (cryptoTip.length) sources.push("coingecko");
  } catch {
    /* optional */
  }

  const snapshot: MarketSnapshot = {
    vnSession,
    vnSessionHint: sessionFreshnessHint(vnSession.state),
    checkedAt,
    global:
      us.length || cryptoTip.length
        ? { us, cryptoTip, sources: sources.filter((s) => s !== "vn-session") }
        : undefined,
  };

  const meta = buildMeta({
    source: sources.join("+"),
    sourceTimestampMs: Date.now(),
    hasData: true,
    note: vnSession.labelVi,
  });
  return { snapshot, meta };
}
