import type { ChartAssetType } from "@/lib/chart-const";

/** Asset types that receive SSE/WS live candle updates on the chart. */
export function supportsLiveChart(assetType: ChartAssetType): boolean {
  return (
    assetType === "crypto" ||
    assetType === "stock" ||
    assetType === "forex" ||
    assetType === "commodity"
  );
}
