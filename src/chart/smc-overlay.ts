/**
 * Convert MoneyFlowAnalysis → chart primitives (price lines + markers).
 * Lightweight Charts has no native zone boxes; we use paired price lines + titles.
 */
import type { MoneyFlowAnalysis } from "@/lib/engines/money-flow";
import type { ChartSignalMarker } from "@/lib/chart-const";

export interface SmcPriceLevel {
  id: string;
  price: number;
  color: string;
  title: string;
  style: "solid" | "dashed" | "dotted";
  width: 1 | 2;
}

export interface SmcOverlayPayload {
  levels: SmcPriceLevel[];
  markers: ChartSignalMarker[];
}

const BULL = "rgba(46,194,126,0.75)";
const BEAR = "rgba(238,95,117,0.75)";
const BULL_SOFT = "rgba(46,194,126,0.40)";
const BEAR_SOFT = "rgba(238,95,117,0.40)";
const OTE = "rgba(168,85,247,0.70)";
const EQ = "rgba(148,163,184,0.55)";
const LIQ = "rgba(250,204,21,0.65)";

export function buildSmcOverlay(analysis: MoneyFlowAnalysis | null | undefined): SmcOverlayPayload {
  if (!analysis) return { levels: [], markers: [] };
  const levels: SmcPriceLevel[] = [];
  const markers: ChartSignalMarker[] = [];

  for (const ob of (analysis.smc.orderBlocks ?? []).slice(0, 4)) {
    if (ob.status === "BREAKER") continue;
    const color = ob.direction === "bullish" ? BULL : BEAR;
    const tag = ob.status === "OPEN" ? "OB" : "OB·M";
    levels.push({
      id: `ob-h-${ob.formedAtIndex}`,
      price: ob.high,
      color,
      title: `${tag}${ob.direction === "bullish" ? "↑" : "↓"}`,
      style: ob.status === "OPEN" ? "solid" : "dashed",
      width: 1,
    });
    levels.push({
      id: `ob-l-${ob.formedAtIndex}`,
      price: ob.low,
      color,
      title: "",
      style: "dotted",
      width: 1,
    });
  }

  for (const fvg of (analysis.smc.fvgs ?? []).slice(0, 4)) {
    if (fvg.status === "FILLED") continue;
    const color = fvg.direction === "bullish" ? BULL_SOFT : BEAR_SOFT;
    levels.push({
      id: `fvg-h-${fvg.formedAtIndex}`,
      price: fvg.high,
      color,
      title: `FVG${fvg.direction === "bullish" ? "↑" : "↓"}`,
      style: fvg.status === "OPEN" ? "dashed" : "dotted",
      width: 1,
    });
    levels.push({
      id: `fvg-l-${fvg.formedAtIndex}`,
      price: fvg.low,
      color,
      title: "",
      style: "dotted",
      width: 1,
    });
  }

  for (const lv of (analysis.liquidity.levels ?? []).slice(0, 6)) {
    if (lv.swept) continue;
    levels.push({
      id: `liq-${lv.type}-${lv.price}`,
      price: lv.price,
      color: LIQ,
      title: lv.isEqual ? (lv.type === "BUY_SIDE" ? "EQH" : "EQL") : lv.type === "BUY_SIDE" ? "BSL" : "SSL",
      style: lv.isEqual ? "solid" : "dashed",
      width: lv.isEqual ? 2 : 1,
    });
  }

  if (analysis.ict.dealingRange) {
    levels.push({
      id: "dr-h",
      price: analysis.ict.dealingRange.high,
      color: EQ,
      title: "DR H",
      style: "dotted",
      width: 1,
    });
    levels.push({
      id: "dr-l",
      price: analysis.ict.dealingRange.low,
      color: EQ,
      title: "DR L",
      style: "dotted",
      width: 1,
    });
  }
  if (analysis.ict.equilibrium != null) {
    levels.push({
      id: "eq",
      price: analysis.ict.equilibrium,
      color: EQ,
      title: "EQ",
      style: "dashed",
      width: 1,
    });
  }
  if (analysis.ict.ote) {
    levels.push({
      id: "ote-h",
      price: analysis.ict.ote.high,
      color: OTE,
      title: "OTE",
      style: "solid",
      width: 1,
    });
    levels.push({
      id: "ote-l",
      price: analysis.ict.ote.low,
      color: OTE,
      title: "",
      style: "dotted",
      width: 1,
    });
  }

  const swings = analysis.structure.swings ?? [];
  for (const sw of swings.slice(-8)) {
    if (sw.type === "high") {
      markers.push({
        time: sw.time,
        type: "breakdown",
        position: "aboveBar",
        title: sw.kind === "external" ? "XH" : "H",
      });
    } else {
      markers.push({
        time: sw.time,
        type: "breakout",
        position: "belowBar",
        title: sw.kind === "external" ? "XL" : "L",
      });
    }
  }

  const lastSwingTime = swings.at(-1)?.time;
  if (lastSwingTime && analysis.structure.mss) {
    markers.push({
      time: lastSwingTime,
      type: analysis.structure.mss === "bullish" ? "buy-signal" : "sell-signal",
      position: analysis.structure.mss === "bullish" ? "belowBar" : "aboveBar",
      title: "MSS",
    });
  } else if (lastSwingTime && analysis.structure.choch) {
    markers.push({
      time: lastSwingTime,
      type: analysis.structure.choch === "bullish" ? "buy-signal" : "sell-signal",
      position: analysis.structure.choch === "bullish" ? "belowBar" : "aboveBar",
      title: "CHoCH",
    });
  } else if (lastSwingTime && analysis.structure.bos) {
    markers.push({
      time: lastSwingTime,
      type: analysis.structure.bos === "bullish" ? "breakout" : "breakdown",
      position: analysis.structure.bos === "bullish" ? "belowBar" : "aboveBar",
      title: "BOS",
    });
  }

  for (const sw of (analysis.liquidity.recentSweeps ?? []).slice(0, 4)) {
    markers.push({
      time: sw.time,
      type: sw.side === "SELL_SIDE" ? "buy-signal" : "sell-signal",
      position: sw.side === "SELL_SIDE" ? "belowBar" : "aboveBar",
      title: sw.reclaimed ? "Sweep↺" : "Sweep",
    });
  }

  return { levels, markers };
}
