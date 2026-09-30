/**
 * Convert MoneyFlowAnalysis → chart primitives (price lines + markers).
 * Compatible with money-flow v1 (single fvg/orderBlock) and v2 (arrays + lifecycle).
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

type AnyAnalysis = MoneyFlowAnalysis & {
  smc?: MoneyFlowAnalysis["smc"] & {
    fvgs?: Array<{ direction: string; low: number; high: number; status?: string; formedAtIndex?: number }>;
    orderBlocks?: Array<{ direction: string; low: number; high: number; status?: string; formedAtIndex?: number }>;
  };
  structure?: MoneyFlowAnalysis["structure"] & {
    swings?: Array<{ time: number; type: "high" | "low"; kind?: string }>;
  };
  liquidity?: MoneyFlowAnalysis["liquidity"] & {
    levels?: Array<{ price: number; type: "BUY_SIDE" | "SELL_SIDE"; isEqual?: boolean; swept?: boolean }>;
    recentSweeps?: Array<{ side: "BUY_SIDE" | "SELL_SIDE"; time: number; reclaimed?: boolean }>;
  };
  ict?: MoneyFlowAnalysis["ict"] & {
    equilibrium?: number | null;
    ote?: { high: number; low: number } | null;
  };
};

export function buildSmcOverlay(analysis: MoneyFlowAnalysis | null | undefined): SmcOverlayPayload {
  if (!analysis) return { levels: [], markers: [] };
  const a = analysis as AnyAnalysis;
  const levels: SmcPriceLevel[] = [];
  const markers: ChartSignalMarker[] = [];

  const orderBlocks =
    a.smc?.orderBlocks?.length
      ? a.smc.orderBlocks
      : a.smc?.orderBlock
        ? [{ ...a.smc.orderBlock, status: "OPEN", formedAtIndex: 0 }]
        : [];

  for (const ob of orderBlocks.slice(0, 4)) {
    if (ob.status === "BREAKER") continue;
    const color = ob.direction === "bullish" ? BULL : BEAR;
    const tag = ob.status === "OPEN" || !ob.status ? "OB" : "OB·M";
    const idx = ob.formedAtIndex ?? 0;
    levels.push({
      id: `ob-h-${idx}`,
      price: ob.high,
      color,
      title: `${tag}${ob.direction === "bullish" ? "↑" : "↓"}`,
      style: ob.status === "OPEN" || !ob.status ? "solid" : "dashed",
      width: 1,
    });
    levels.push({
      id: `ob-l-${idx}`,
      price: ob.low,
      color,
      title: "",
      style: "dotted",
      width: 1,
    });
  }

  const fvgs =
    a.smc?.fvgs?.length
      ? a.smc.fvgs
      : a.smc?.fvg
        ? [{ ...a.smc.fvg, formedAtIndex: 0 }]
        : [];

  for (const fvg of fvgs.slice(0, 4)) {
    if (fvg.status === "FILLED") continue;
    const color = fvg.direction === "bullish" ? BULL_SOFT : BEAR_SOFT;
    const idx = fvg.formedAtIndex ?? 0;
    levels.push({
      id: `fvg-h-${idx}`,
      price: fvg.high,
      color,
      title: `FVG${fvg.direction === "bullish" ? "↑" : "↓"}`,
      style: fvg.status === "OPEN" || !fvg.status ? "dashed" : "dotted",
      width: 1,
    });
    levels.push({
      id: `fvg-l-${idx}`,
      price: fvg.low,
      color,
      title: "",
      style: "dotted",
      width: 1,
    });
  }

  const liqLevels = a.liquidity?.levels ?? [];
  for (const lv of liqLevels.slice(0, 6)) {
    if (lv.swept) continue;
    levels.push({
      id: `liq-${lv.type}-${lv.price}`,
      price: lv.price,
      color: LIQ,
      title: lv.isEqual
        ? lv.type === "BUY_SIDE"
          ? "EQH"
          : "EQL"
        : lv.type === "BUY_SIDE"
          ? "BSL"
          : "SSL",
      style: lv.isEqual ? "solid" : "dashed",
      width: lv.isEqual ? 2 : 1,
    });
  }

  if (!liqLevels.length) {
    if (a.liquidity?.nearestBuySide != null) {
      levels.push({ id: "liq-bsl", price: a.liquidity.nearestBuySide, color: LIQ, title: "BSL", style: "dashed", width: 1 });
    }
    if (a.liquidity?.nearestSellSide != null) {
      levels.push({ id: "liq-ssl", price: a.liquidity.nearestSellSide, color: LIQ, title: "SSL", style: "dashed", width: 1 });
    }
  }

  if (a.ict?.dealingRange) {
    levels.push({ id: "dr-h", price: a.ict.dealingRange.high, color: EQ, title: "DR H", style: "dotted", width: 1 });
    levels.push({ id: "dr-l", price: a.ict.dealingRange.low, color: EQ, title: "DR L", style: "dotted", width: 1 });
  }

  const eq =
    a.ict?.equilibrium ??
    (a.ict?.dealingRange ? (a.ict.dealingRange.high + a.ict.dealingRange.low) / 2 : null);
  if (eq != null && Number.isFinite(eq)) {
    levels.push({ id: "eq", price: eq, color: EQ, title: "EQ", style: "dashed", width: 1 });
  }

  if (a.ict?.ote) {
    levels.push({ id: "ote-h", price: a.ict.ote.high, color: OTE, title: "OTE", style: "solid", width: 1 });
    levels.push({ id: "ote-l", price: a.ict.ote.low, color: OTE, title: "", style: "dotted", width: 1 });
  }

  const swings = a.structure?.swings ?? [];
  for (const sw of swings.slice(-8)) {
    if (sw.type === "high") {
      markers.push({ time: sw.time, type: "breakdown", position: "aboveBar", title: sw.kind === "external" ? "XH" : "H" });
    } else {
      markers.push({ time: sw.time, type: "breakout", position: "belowBar", title: sw.kind === "external" ? "XL" : "L" });
    }
  }

  const lastSwingTime = swings.at(-1)?.time;
  if (lastSwingTime && a.structure?.mss) {
    markers.push({
      time: lastSwingTime,
      type: a.structure.mss === "bullish" ? "buy-signal" : "sell-signal",
      position: a.structure.mss === "bullish" ? "belowBar" : "aboveBar",
      title: "MSS",
    });
  } else if (lastSwingTime && a.structure?.choch) {
    markers.push({
      time: lastSwingTime,
      type: a.structure.choch === "bullish" ? "buy-signal" : "sell-signal",
      position: a.structure.choch === "bullish" ? "belowBar" : "aboveBar",
      title: "CHoCH",
    });
  } else if (lastSwingTime && a.structure?.bos) {
    markers.push({
      time: lastSwingTime,
      type: a.structure.bos === "bullish" ? "breakout" : "breakdown",
      position: a.structure.bos === "bullish" ? "belowBar" : "aboveBar",
      title: "BOS",
    });
  }

  for (const sw of (a.liquidity?.recentSweeps ?? []).slice(0, 4)) {
    markers.push({
      time: sw.time,
      type: sw.side === "SELL_SIDE" ? "buy-signal" : "sell-signal",
      position: sw.side === "SELL_SIDE" ? "belowBar" : "aboveBar",
      title: sw.reclaimed ? "Sweep↺" : "Sweep",
    });
  }

  return { levels, markers };
}
