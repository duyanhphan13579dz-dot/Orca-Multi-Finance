/**
 * Apply / clear SMC price-line overlays on a candlestick series.
 * Keeps SeriesManager lean — call from OrcaFinancialChart after setHistory.
 */
import { LineStyle, type IPriceLine, type ISeriesApi } from "lightweight-charts";

export type SmcLineInput = {
  price: number;
  color: string;
  title: string;
  style?: "solid" | "dashed" | "dotted";
  width?: 1 | 2;
};

const styleMap = {
  solid: LineStyle.Solid,
  dashed: LineStyle.Dashed,
  dotted: LineStyle.Dotted,
} as const;

/** Mutable bag held by the chart component across rebuilds. */
export type SmcLineBag = { lines: IPriceLine[] };

export function clearSmcPriceLines(
  series: ISeriesApi<"Candlestick"> | null | undefined,
  bag: SmcLineBag,
) {
  if (!series) {
    bag.lines = [];
    return;
  }
  for (const l of bag.lines) {
    try {
      series.removePriceLine(l);
    } catch {
      /* */
    }
  }
  bag.lines = [];
}

export function applySmcPriceLines(
  series: ISeriesApi<"Candlestick"> | null | undefined,
  bag: SmcLineBag,
  levels: SmcLineInput[],
) {
  clearSmcPriceLines(series, bag);
  if (!series || !levels?.length) return;
  for (const lv of levels.slice(0, 28)) {
    if (!Number.isFinite(lv.price) || lv.price <= 0) continue;
    try {
      bag.lines.push(
        series.createPriceLine({
          price: lv.price,
          color: lv.color,
          lineWidth: lv.width ?? 1,
          lineStyle: styleMap[lv.style ?? "dashed"],
          axisLabelVisible: Boolean(lv.title),
          title: lv.title || "",
        }),
      );
    } catch {
      /* */
    }
  }
}
