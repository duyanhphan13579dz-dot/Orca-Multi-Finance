import "server-only";
import { ssiFcConfigured } from "../providers/ssi-fcdata";
import type { VndForeignFlowSummary } from "../providers/vndirect";

/**
 * Fallback khối ngoại khi VNDirect foreigns fail:
 * tổng netForeignVal từ SSI DailyStockPrice trên rổ thanh khoản (partial, không full HOSE).
 */
const FALLBACK_BOARD = [
  "VCB", "BID", "CTG", "TCB", "MBB", "VPB", "ACB", "STB", "HDB", "VIB", "TPB", "SHB",
  "VIC", "VHM", "VRE", "HPG", "FPT", "VNM", "MSN", "MWG", "GAS", "PLX", "SSI", "VND",
  "GVR", "BVH", "VJC", "POW", "REE", "SAB",
];

export async function getSsiForeignFlowFallback(): Promise<VndForeignFlowSummary | null> {
  if (!ssiFcConfigured()) return null;
  try {
    const { getSsiStockSummary } = await import("../providers/ssi-market-catalog");
    const settled = await Promise.allSettled(
      FALLBACK_BOARD.map((s) => getSsiStockSummary(s)),
    );
    let buyVal = 0;
    let sellVal = 0;
    let sessionDate: string | null = null;
    const rows: { symbol: string; buyVal: number; sellVal: number; netVal: number; floor: string | null }[] = [];
    for (const r of settled) {
      if (r.status !== "fulfilled") continue;
      const s = r.value;
      const b = s.foreignBuyVal ?? 0;
      const sell = s.foreignSellVal ?? 0;
      if (!b && !sell && !(s.netForeignVal != null)) continue;
      const net = s.netForeignVal ?? b - sell;
      buyVal += b;
      sellVal += sell;
      if (s.tradingDate && !sessionDate) sessionDate = s.tradingDate;
      rows.push({ symbol: s.symbol, buyVal: b, sellVal: sell, netVal: net, floor: null });
    }
    if (!rows.length) return null;
    rows.sort((a, b) => b.netVal - a.netVal);
    const today =
      sessionDate ??
      new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
    return {
      sessionDate: today,
      buyVal,
      sellVal,
      netVal: buyVal - sellVal,
      stockCount: rows.length,
      topNetBuy: rows.filter((x) => x.netVal > 0).slice(0, 10),
      topNetSell: rows
        .filter((x) => x.netVal < 0)
        .sort((a, b) => a.netVal - b.netVal)
        .slice(0, 10),
      sourceTs: Date.now(),
    };
  } catch (e) {
    console.warn("[getSsiForeignFlowFallback]", e);
    return null;
  }
}
