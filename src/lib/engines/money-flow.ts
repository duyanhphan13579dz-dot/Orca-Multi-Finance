import type { OhlcvBar } from "../types";

export type FlowDirection = "bullish" | "bearish" | "neutral";
export type MarketRegime =
  | "TREND_UP"
  | "TREND_DOWN"
  | "RANGE"
  | "HIGH_VOLATILITY"
  | "LOW_VOLATILITY"
  | "TRANSITION";
export type FlowState =
  | "ACCUMULATION_CANDIDATE"
  | "DEMAND_EXPANSION"
  | "BULLISH_CONTINUATION"
  | "BULLISH_PULLBACK"
  | "ABSORPTION_BULLISH"
  | "LIQUIDITY_SWEEP_BULLISH"
  | "DISTRIBUTION_CANDIDATE"
  | "SUPPLY_EXPANSION"
  | "BEARISH_CONTINUATION"
  | "BEARISH_PULLBACK"
  | "ABSORPTION_BEARISH"
  | "LIQUIDITY_SWEEP_BEARISH"
  | "BALANCED"
  | "CONFLICTED"
  | "UNCERTAIN";

export type ZoneStatus = "OPEN" | "PARTIAL" | "MITIGATED" | "BREAKER";
export type FvgStatus = "OPEN" | "PARTIAL" | "FILLED";
export type SwingKind = "internal" | "external";
export type LiquiditySide = "BUY_SIDE" | "SELL_SIDE";

export interface MoneyFlowConfig {
  volumePeriod: number;
  rvolHigh: number;
  rvolExtreme: number;
  absorptionSpreadRatio: number;
  /** Internal structure swing half-window (default 2 → 5-bar pivot). */
  internalSwingLength: number;
  /** External structure swing half-window (default 5 → 11-bar pivot). */
  externalSwingLength: number;
  equalLevelAtrTolerance: number;
  displacementRatio: number;
  /** Max historical FVGs / OBs to retain in the snapshot. */
  maxZones: number;
  /** Lookback for dealing-range structure (bars). */
  dealingRangeBars: number;
}

export const DEFAULT_MONEY_FLOW_CONFIG: MoneyFlowConfig = {
  volumePeriod: 20,
  rvolHigh: 1.5,
  rvolExtreme: 2.5,
  absorptionSpreadRatio: 0.7,
  internalSwingLength: 2,
  externalSwingLength: 5,
  equalLevelAtrTolerance: 0.15,
  displacementRatio: 1.8,
  maxZones: 8,
  dealingRangeBars: 80,
};

export interface SwingPoint {
  index: number;
  time: number;
  price: number;
  kind: SwingKind;
  type: "high" | "low";
}

export interface FairValueGap {
  direction: FlowDirection;
  low: number;
  high: number;
  mid: number;
  formedAtIndex: number;
  formedAtTime: number;
  status: FvgStatus;
  /** 0 = untouched, 1 = fully filled. */
  fillFraction: number;
  size: number;
}

export interface OrderBlock {
  direction: FlowDirection;
  low: number;
  high: number;
  mid: number;
  formedAtIndex: number;
  formedAtTime: number;
  status: ZoneStatus;
  /** True when a liquidity sweep occurred shortly before the displacement. */
  hadLiquiditySweep: boolean;
  /** True when displacement that created the OB also left an FVG. */
  hasDisplacementFvg: boolean;
  touchCount: number;
}

export interface LiquidityLevel {
  price: number;
  type: LiquiditySide;
  strength: number;
  equalCount: number;
  isEqual: boolean;
  swept: boolean;
  sweptAtIndex: number | null;
}

export interface SweepEvent {
  side: LiquiditySide;
  level: number;
  barIndex: number;
  time: number;
  reclaimed: boolean;
}

export interface MoneyFlowAnalysis {
  score: number;
  confidence: number;
  state: FlowState;
  regime: MarketRegime;
  vsa: {
    rvol: number | null;
    clv: number | null;
    effortResult: FlowDirection;
    absorption: FlowDirection | null;
    climax: FlowDirection | null;
    events: string[];
  };
  structure: {
    trend: FlowDirection;
    bos: FlowDirection | null;
    choch: FlowDirection | null;
    mss: FlowDirection | null;
    swingHigh: number | null;
    swingLow: number | null;
    /** Internal (LTF) structure. */
    internal: {
      trend: FlowDirection;
      bos: FlowDirection | null;
      choch: FlowDirection | null;
      swingHigh: number | null;
      swingLow: number | null;
    };
    /** External (HTF-like) structure. */
    external: {
      trend: FlowDirection;
      bos: FlowDirection | null;
      choch: FlowDirection | null;
      swingHigh: number | null;
      swingLow: number | null;
    };
    swings: SwingPoint[];
  };
  liquidity: {
    sweep: LiquiditySide | null;
    nearestBuySide: number | null;
    nearestSellSide: number | null;
    levels: LiquidityLevel[];
    recentSweeps: SweepEvent[];
    equalHighs: number[];
    equalLows: number[];
  };
  smc: {
    displacement: FlowDirection | null;
    /** Most recent relevant FVG (OPEN preferred, else PARTIAL). Backward-compat field. */
    fvg: {
      direction: FlowDirection;
      low: number;
      high: number;
      status: "OPEN" | "FILLED" | "PARTIAL";
    } | null;
    /** Most recent relevant OB. Backward-compat field. */
    orderBlock: {
      direction: FlowDirection;
      low: number;
      high: number;
      status?: ZoneStatus;
    } | null;
    fvgs: FairValueGap[];
    orderBlocks: OrderBlock[];
  };
  ict: {
    premiumDiscount: "PREMIUM" | "DISCOUNT" | "EQUILIBRIUM" | "UNKNOWN";
    dealingRange: { high: number; low: number } | null;
    equilibrium: number | null;
    /** Optimal Trade Entry zone (62–79% retracement into discount/premium). */
    ote: { low: number; high: number; direction: FlowDirection } | null;
    inOte: boolean;
  };
}

const clamp = (value: number, min = -100, max = 100) => Math.max(min, Math.min(max, value));

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function direction(value: number, threshold = 0.08): FlowDirection {
  return value > threshold ? "bullish" : value < -threshold ? "bearish" : "neutral";
}

function trueRange(bar: OhlcvBar, prev: OhlcvBar | null): number {
  if (!prev) return bar.high - bar.low;
  return Math.max(bar.high - bar.low, Math.abs(bar.high - prev.close), Math.abs(bar.low - prev.close));
}

function atrSeries(bars: OhlcvBar[], period = 14): number {
  if (bars.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    trs.push(trueRange(bars[i]!, i > 0 ? bars[i - 1]! : null));
  }
  if (trs.length < period) return average(trs);
  let avg = average(trs.slice(0, period));
  for (let i = period; i < trs.length; i++) {
    avg = (avg * (period - 1) + trs[i]!) / period;
  }
  return avg;
}

function findSwings(bars: OhlcvBar[], halfWindow: number, kind: SwingKind): SwingPoint[] {
  const out: SwingPoint[] = [];
  if (bars.length < halfWindow * 2 + 1) return out;
  for (let i = halfWindow; i < bars.length - halfWindow; i++) {
    const window = bars.slice(i - halfWindow, i + halfWindow + 1);
    const hi = Math.max(...window.map((b) => b.high));
    const lo = Math.min(...window.map((b) => b.low));
    const bar = bars[i]!;
    if (bar.high === hi) {
      out.push({ index: i, time: bar.time, price: bar.high, kind, type: "high" });
    }
    if (bar.low === lo) {
      out.push({ index: i, time: bar.time, price: bar.low, kind, type: "low" });
    }
  }
  return out;
}

function structureFromSwings(
  swings: SwingPoint[],
  lastClose: number,
): {
  trend: FlowDirection;
  bos: FlowDirection | null;
  choch: FlowDirection | null;
  swingHigh: number | null;
  swingLow: number | null;
} {
  const highs = swings.filter((s) => s.type === "high");
  const lows = swings.filter((s) => s.type === "low");
  const swingHigh = highs.at(-1)?.price ?? null;
  const swingLow = lows.at(-1)?.price ?? null;
  const priorHigh = highs.at(-2)?.price ?? null;
  const priorLow = lows.at(-2)?.price ?? null;

  let trend: FlowDirection = "neutral";
  if (priorHigh != null && priorLow != null && swingHigh != null && swingLow != null) {
    if (swingHigh > priorHigh && swingLow > priorLow) trend = "bullish";
    else if (swingHigh < priorHigh && swingLow < priorLow) trend = "bearish";
  }

  const bos: FlowDirection | null =
    swingHigh != null && lastClose > swingHigh
      ? "bullish"
      : swingLow != null && lastClose < swingLow
        ? "bearish"
        : null;

  const choch: FlowDirection | null =
    bos && trend !== "neutral" && bos !== trend ? bos : null;

  return { trend, bos, choch, swingHigh, swingLow };
}

function detectFvgs(bars: OhlcvBar[], maxZones: number): FairValueGap[] {
  const fvgs: FairValueGap[] = [];
  for (let i = 2; i < bars.length; i++) {
    const left = bars[i - 2]!;
    const mid = bars[i - 1]!;
    const right = bars[i]!;
    if (left.high < right.low && right.close > mid.open) {
      const low = left.high;
      const high = right.low;
      if (high > low) {
        fvgs.push({
          direction: "bullish",
          low,
          high,
          mid: (low + high) / 2,
          formedAtIndex: i,
          formedAtTime: right.time,
          status: "OPEN",
          fillFraction: 0,
          size: high - low,
        });
      }
    }
    if (left.low > right.high && right.close < mid.open) {
      const low = right.high;
      const high = left.low;
      if (high > low) {
        fvgs.push({
          direction: "bearish",
          low,
          high,
          mid: (low + high) / 2,
          formedAtIndex: i,
          formedAtTime: right.time,
          status: "OPEN",
          fillFraction: 0,
          size: high - low,
        });
      }
    }
  }

  for (const fvg of fvgs) {
    let deepestFill = 0;
    for (let j = fvg.formedAtIndex + 1; j < bars.length; j++) {
      const bar = bars[j]!;
      if (fvg.direction === "bullish") {
        if (bar.low <= fvg.high) {
          const fill = (fvg.high - Math.max(bar.low, fvg.low)) / fvg.size;
          deepestFill = Math.max(deepestFill, Math.min(1, fill));
        }
        if (bar.low <= fvg.low) deepestFill = 1;
      } else {
        if (bar.high >= fvg.low) {
          const fill = (Math.min(bar.high, fvg.high) - fvg.low) / fvg.size;
          deepestFill = Math.max(deepestFill, Math.min(1, fill));
        }
        if (bar.high >= fvg.high) deepestFill = 1;
      }
    }
    fvg.fillFraction = deepestFill;
    fvg.status = deepestFill >= 0.99 ? "FILLED" : deepestFill >= 0.15 ? "PARTIAL" : "OPEN";
  }

  const openOrPartial = fvgs.filter((f) => f.status !== "FILLED").reverse();
  const filled = fvgs.filter((f) => f.status === "FILLED").reverse();
  return [...openOrPartial, ...filled].slice(0, maxZones);
}

function detectOrderBlocks(
  bars: OhlcvBar[],
  swings: SwingPoint[],
  atr: number,
  cfg: MoneyFlowConfig,
): OrderBlock[] {
  const obs: OrderBlock[] = [];
  const medianSpread = median(bars.slice(-30).map((b) => b.high - b.low));
  const dispThreshold = medianSpread * cfg.displacementRatio;

  for (let i = 3; i < bars.length; i++) {
    const bar = bars[i]!;
    const spread = bar.high - bar.low;
    const body = Math.abs(bar.close - bar.open);
    const clv =
      spread > 0 ? ((bar.close - bar.low) - (bar.high - bar.close)) / spread : 0;
    const isDisplacement =
      spread >= dispThreshold && Math.abs(clv) > 0.5 && body / Math.max(spread, Number.EPSILON) > 0.55;
    if (!isDisplacement) continue;

    const dir: FlowDirection = bar.close > bar.open ? "bullish" : "bearish";

    let obBar: OhlcvBar | null = null;
    let obIndex = -1;
    for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
      const candidate = bars[j]!;
      const opposite =
        dir === "bullish" ? candidate.close < candidate.open : candidate.close > candidate.open;
      if (opposite) {
        obBar = candidate;
        obIndex = j;
        break;
      }
    }
    if (!obBar || obIndex < 0) continue;

    const lookbackStart = Math.max(0, obIndex - 8);
    let hadSweep = false;
    for (const swing of swings) {
      if (swing.index < lookbackStart || swing.index > obIndex) continue;
      for (let k = swing.index + 1; k <= obIndex; k++) {
        const b = bars[k]!;
        if (swing.type === "low" && b.low < swing.price && b.close > swing.price) {
          hadSweep = true;
          break;
        }
        if (swing.type === "high" && b.high > swing.price && b.close < swing.price) {
          hadSweep = true;
          break;
        }
      }
      if (hadSweep) break;
    }

    let hasFvg = false;
    if (i >= 2) {
      const left = bars[i - 2]!;
      if (dir === "bullish" && left.high < bar.low) hasFvg = true;
      if (dir === "bearish" && left.low > bar.high) hasFvg = true;
    }

    const low = obBar.low;
    const high = obBar.high;
    obs.push({
      direction: dir,
      low,
      high,
      mid: (low + high) / 2,
      formedAtIndex: obIndex,
      formedAtTime: obBar.time,
      status: "OPEN",
      hadLiquiditySweep: hadSweep,
      hasDisplacementFvg: hasFvg,
      touchCount: 0,
    });
  }

  for (const ob of obs) {
    let touches = 0;
    let mitigated = false;
    let broken = false;
    for (let j = ob.formedAtIndex + 1; j < bars.length; j++) {
      const bar = bars[j]!;
      const overlaps =
        bar.low <= ob.high + atr * 0.05 && bar.high >= ob.low - atr * 0.05;
      if (overlaps) touches++;
      if (ob.direction === "bullish") {
        if (bar.low <= ob.high && bar.high >= ob.low) mitigated = true;
        if (bar.close < ob.low) broken = true;
      } else {
        if (bar.high >= ob.low && bar.low <= ob.high) mitigated = true;
        if (bar.close > ob.high) broken = true;
      }
    }
    ob.touchCount = touches;
    if (broken) ob.status = "BREAKER";
    else if (mitigated) ob.status = "MITIGATED";
    else ob.status = "OPEN";
  }

  const open = obs.filter((o) => o.status === "OPEN").reverse();
  const rest = obs.filter((o) => o.status !== "OPEN").reverse();
  return [...open, ...rest].slice(0, cfg.maxZones);
}

function clusterEqualLevels(
  prices: number[],
  tolerance: number,
): { price: number; count: number }[] {
  if (!prices.length) return [];
  const sorted = [...prices].sort((a, b) => a - b);
  const clusters: { price: number; count: number; sum: number }[] = [];
  for (const p of sorted) {
    const last = clusters.at(-1);
    if (last && Math.abs(p - last.price) <= tolerance) {
      last.count += 1;
      last.sum += p;
      last.price = last.sum / last.count;
    } else {
      clusters.push({ price: p, count: 1, sum: p });
    }
  }
  return clusters.map((c) => ({ price: c.price, count: c.count }));
}

function levelsTouchCount(bars: OhlcvBar[], level: number, tolerance: number) {
  return bars.filter(
    (bar) => Math.abs(bar.high - level) <= tolerance || Math.abs(bar.low - level) <= tolerance,
  ).length;
}

function buildLiquidity(
  bars: OhlcvBar[],
  swings: SwingPoint[],
  atr: number,
  cfg: MoneyFlowConfig,
): {
  levels: LiquidityLevel[];
  recentSweeps: SweepEvent[];
  equalHighs: number[];
  equalLows: number[];
  nearestBuySide: number | null;
  nearestSellSide: number | null;
  sweep: LiquiditySide | null;
} {
  const tolerance = atr * cfg.equalLevelAtrTolerance;
  const highPrices = swings.filter((s) => s.type === "high").map((s) => s.price);
  const lowPrices = swings.filter((s) => s.type === "low").map((s) => s.price);

  const eqHighs = clusterEqualLevels(highPrices, tolerance).filter((c) => c.count >= 2);
  const eqLows = clusterEqualLevels(lowPrices, tolerance).filter((c) => c.count >= 2);

  const rawLevels: { price: number; type: LiquiditySide; equalCount: number; isEqual: boolean }[] = [
    ...highPrices.slice(-12).map((price) => {
      const eq = eqHighs.find((e) => Math.abs(e.price - price) <= tolerance);
      return {
        price: eq?.price ?? price,
        type: "BUY_SIDE" as const,
        equalCount: eq?.count ?? 1,
        isEqual: Boolean(eq),
      };
    }),
    ...lowPrices.slice(-12).map((price) => {
      const eq = eqLows.find((e) => Math.abs(e.price - price) <= tolerance);
      return {
        price: eq?.price ?? price,
        type: "SELL_SIDE" as const,
        equalCount: eq?.count ?? 1,
        isEqual: Boolean(eq),
      };
    }),
  ];

  const deduped: typeof rawLevels = [];
  for (const level of rawLevels) {
    const existing = deduped.find(
      (d) => d.type === level.type && Math.abs(d.price - level.price) <= tolerance,
    );
    if (existing) {
      existing.equalCount = Math.max(existing.equalCount, level.equalCount);
      existing.isEqual = existing.isEqual || level.isEqual;
    } else {
      deduped.push({ ...level });
    }
  }

  const levels: LiquidityLevel[] = deduped.map((level) => {
    let swept = false;
    let sweptAtIndex: number | null = null;
    const swingIdx =
      swings.find(
        (s) =>
          Math.abs(s.price - level.price) <= tolerance &&
          ((level.type === "BUY_SIDE" && s.type === "high") ||
            (level.type === "SELL_SIDE" && s.type === "low")),
      )?.index ?? 0;

    for (let j = swingIdx + 1; j < bars.length; j++) {
      const bar = bars[j]!;
      if (level.type === "BUY_SIDE" && bar.high > level.price) {
        swept = true;
        sweptAtIndex = j;
        break;
      }
      if (level.type === "SELL_SIDE" && bar.low < level.price) {
        swept = true;
        sweptAtIndex = j;
        break;
      }
    }

    const touches = levelsTouchCount(bars, level.price, tolerance);
    const strength = Math.min(
      100,
      40 + touches * 8 + (level.isEqual ? 15 : 0) + (level.equalCount - 1) * 10,
    );

    return {
      price: level.price,
      type: level.type,
      strength,
      equalCount: level.equalCount,
      isEqual: level.isEqual,
      swept,
      sweptAtIndex,
    };
  });

  const recentSweeps: SweepEvent[] = [];
  for (const level of levels) {
    if (!level.swept || level.sweptAtIndex == null) continue;
    const bar = bars[level.sweptAtIndex]!;
    const reclaimed =
      level.type === "SELL_SIDE" ? bar.close > level.price : bar.close < level.price;
    recentSweeps.push({
      side: level.type,
      level: level.price,
      barIndex: level.sweptAtIndex,
      time: bar.time,
      reclaimed,
    });
  }
  recentSweeps.sort((a, b) => b.barIndex - a.barIndex);
  const trimmedSweeps = recentSweeps.slice(0, 6);

  const last = bars.at(-1)!;
  const unsweptBuy = levels
    .filter((l) => l.type === "BUY_SIDE" && !l.swept)
    .sort((a, b) => Math.abs(last.close - a.price) - Math.abs(last.close - b.price));
  const unsweptSell = levels
    .filter((l) => l.type === "SELL_SIDE" && !l.swept)
    .sort((a, b) => Math.abs(last.close - a.price) - Math.abs(last.close - b.price));
  const nearestBuySide =
    unsweptBuy[0]?.price ??
    levels
      .filter((l) => l.type === "BUY_SIDE")
      .sort((a, b) => Math.abs(last.close - a.price) - Math.abs(last.close - b.price))[0]?.price ??
    null;
  const nearestSellSide =
    unsweptSell[0]?.price ??
    levels
      .filter((l) => l.type === "SELL_SIDE")
      .sort((a, b) => Math.abs(last.close - a.price) - Math.abs(last.close - b.price))[0]?.price ??
    null;

  let sweep: LiquiditySide | null = null;
  if (nearestSellSide != null && last.low < nearestSellSide && last.close > nearestSellSide) {
    sweep = "SELL_SIDE";
  } else if (nearestBuySide != null && last.high > nearestBuySide && last.close < nearestBuySide) {
    sweep = "BUY_SIDE";
  } else {
    const recent = trimmedSweeps.find((s) => s.barIndex >= bars.length - 3 && s.reclaimed);
    if (recent) sweep = recent.side;
  }

  return {
    levels: levels.sort((a, b) => b.strength - a.strength).slice(0, 16),
    recentSweeps: trimmedSweeps,
    equalHighs: eqHighs.map((e) => e.price),
    equalLows: eqLows.map((e) => e.price),
    nearestBuySide,
    nearestSellSide,
    sweep,
  };
}

function analyzeVsa(bars: OhlcvBar[], cfg: MoneyFlowConfig): MoneyFlowAnalysis["vsa"] {
  const last = bars.at(-1)!;
  const previous = bars.at(-2)!;
  const recent = bars.slice(-cfg.volumePeriod);
  const spreads = recent.map((bar) => Math.max(bar.high - bar.low, Number.EPSILON));
  const volumes = recent.map((bar) => Math.max(0, bar.volume));
  const avgVolume = average(volumes);
  const avgSpread = average(spreads);
  const rvol = avgVolume > 0 ? last.volume / avgVolume : null;
  const spread = Math.max(last.high - last.low, Number.EPSILON);
  const clv = ((last.close - last.low) - (last.high - last.close)) / spread;
  const result = (last.close - previous.close) / Math.max(previous.close, Number.EPSILON);
  const resultBaseline = average(
    bars.slice(-Math.min(20, bars.length)).map((bar, index, arr) =>
      index
        ? Math.abs(bar.close - arr[index - 1]!.close) / Math.max(arr[index - 1]!.close, Number.EPSILON)
        : 0,
    ),
  );

  const effortValue =
    (rvol ?? 0) > cfg.rvolHigh
      ? clv > 0.15 && result > resultBaseline
        ? 1
        : clv < -0.15 && result < -resultBaseline
          ? -1
          : 0
      : 0;
  const effortResult = direction(effortValue);

  const lowerWick = Math.min(last.open, last.close) - last.low;
  const upperWick = last.high - Math.max(last.open, last.close);
  const absorption =
    (rvol ?? 0) >= 1.8 && spread <= avgSpread * cfg.absorptionSpreadRatio
      ? lowerWick > spread * 0.35 && clv > 0
        ? ("bullish" as const)
        : upperWick > spread * 0.35 && clv < 0
          ? ("bearish" as const)
          : null
      : null;

  const look = Math.min(8, bars.length - 1);
  const uptrend = bars.at(-look)!.close < previous.close && previous.close < last.close;
  const downtrend = bars.at(-look)!.close > previous.close && previous.close > last.close;
  const climax =
    (rvol ?? 0) >= cfg.rvolExtreme && spread > avgSpread * 1.4
      ? uptrend && clv < 0.35
        ? ("bearish" as const)
        : downtrend && clv > -0.35
          ? ("bullish" as const)
          : null
      : null;

  const isUpBar = last.close > last.open;
  const isDownBar = last.close < last.open;
  const narrowSpread = spread <= avgSpread * 0.7;
  const lowVol = (rvol ?? 1) < 0.7;
  const noDemand = isUpBar && narrowSpread && lowVol;
  const noSupply = isDownBar && narrowSpread && lowVol;

  const stoppingBullish =
    (rvol ?? 0) >= cfg.rvolHigh && narrowSpread && downtrend && lowerWick > spread * 0.4;
  const stoppingBearish =
    (rvol ?? 0) >= cfg.rvolHigh && narrowSpread && uptrend && upperWick > spread * 0.4;

  const testBullish =
    lowVol && isUpBar && lowerWick > spread * 0.3 && last.close > previous.low;
  const testBearish =
    lowVol && isDownBar && upperWick > spread * 0.3 && last.close < previous.high;

  const events = [
    effortResult === "bullish" ? "DEMAND_EXPANSION" : effortResult === "bearish" ? "SUPPLY_EXPANSION" : null,
    absorption === "bullish" ? "ABSORPTION_BULLISH" : absorption === "bearish" ? "ABSORPTION_BEARISH" : null,
    climax === "bullish" ? "CLIMAX_DOWN" : climax === "bearish" ? "CLIMAX_UP" : null,
    noDemand ? "NO_DEMAND" : null,
    noSupply ? "NO_SUPPLY" : null,
    stoppingBullish ? "STOPPING_VOLUME_BULLISH" : null,
    stoppingBearish ? "STOPPING_VOLUME_BEARISH" : null,
    testBullish ? "TEST_BULLISH" : null,
    testBearish ? "TEST_BEARISH" : null,
  ].filter((event): event is string => Boolean(event));

  return { rvol, clv, effortResult, absorption, climax, events };
}

function resolveState(input: {
  score: number;
  sweep: LiquiditySide | null;
  mss: FlowDirection | null;
  displacement: FlowDirection | null;
  absorption: FlowDirection | null;
  bos: FlowDirection | null;
  effortResult: FlowDirection;
  premiumDiscount: "PREMIUM" | "DISCOUNT" | "EQUILIBRIUM" | "UNKNOWN";
  vsaEvents: string[];
  agreementBull: number;
  agreementBear: number;
}): FlowState {
  const {
    score,
    sweep,
    mss,
    displacement,
    absorption,
    bos,
    effortResult,
    premiumDiscount,
    vsaEvents,
    agreementBull,
    agreementBear,
  } = input;

  if (sweep === "SELL_SIDE" && (mss === "bullish" || displacement === "bullish")) {
    return "LIQUIDITY_SWEEP_BULLISH";
  }
  if (sweep === "BUY_SIDE" && (mss === "bearish" || displacement === "bearish")) {
    return "LIQUIDITY_SWEEP_BEARISH";
  }
  if (absorption === "bullish" || vsaEvents.includes("STOPPING_VOLUME_BULLISH")) {
    return "ABSORPTION_BULLISH";
  }
  if (absorption === "bearish" || vsaEvents.includes("STOPPING_VOLUME_BEARISH")) {
    return "ABSORPTION_BEARISH";
  }
  if (agreementBull >= 2 && agreementBear >= 2) return "CONFLICTED";

  if (
    score > 15 &&
    premiumDiscount === "DISCOUNT" &&
    (vsaEvents.includes("NO_SUPPLY") || effortResult === "bullish" || absorption === "bullish")
  ) {
    return "ACCUMULATION_CANDIDATE";
  }
  if (
    score < -15 &&
    premiumDiscount === "PREMIUM" &&
    (vsaEvents.includes("NO_DEMAND") || effortResult === "bearish" || absorption === "bearish")
  ) {
    return "DISTRIBUTION_CANDIDATE";
  }

  if (score > 35) {
    if (bos === "bullish") return "BULLISH_CONTINUATION";
    if (displacement === "bullish" || effortResult === "bullish") return "DEMAND_EXPANSION";
    return "BULLISH_PULLBACK";
  }
  if (score < -35) {
    if (bos === "bearish") return "BEARISH_CONTINUATION";
    if (displacement === "bearish" || effortResult === "bearish") return "SUPPLY_EXPANSION";
    return "BEARISH_PULLBACK";
  }

  if (Math.abs(score) < 12 && agreementBull + agreementBear <= 1) return "UNCERTAIN";
  return "BALANCED";
}

export function analyzeMoneyFlow(
  input: OhlcvBar[],
  config: Partial<MoneyFlowConfig> = {},
): MoneyFlowAnalysis | null {
  const cfg: MoneyFlowConfig = {
    ...DEFAULT_MONEY_FLOW_CONFIG,
    ...config,
    ...((config as Partial<MoneyFlowConfig> & { swingLength?: number }).swingLength != null
      ? {
          internalSwingLength: (config as { swingLength?: number }).swingLength!,
        }
      : {}),
  };

  const bars = input.filter((bar) =>
    [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite),
  );
  const minBars = Math.max(40, cfg.externalSwingLength * 3 + 10);
  if (bars.length < minBars) return null;

  const last = bars.at(-1)!;
  const atr = atrSeries(bars, 14);

  const vsa = analyzeVsa(bars, cfg);

  const internalSwings = findSwings(bars, cfg.internalSwingLength, "internal");
  const externalSwings = findSwings(bars, cfg.externalSwingLength, "external");
  const allSwings = [...internalSwings, ...externalSwings].sort((a, b) => a.index - b.index);

  const internal = structureFromSwings(internalSwings, last.close);
  const external = structureFromSwings(externalSwings, last.close);

  const primaryTrend =
    external.trend !== "neutral" ? external.trend : internal.trend;
  const bos = external.bos ?? internal.bos;
  const choch = external.choch ?? internal.choch;

  const medianSpread = median(bars.slice(-20).map((bar) => bar.high - bar.low));
  const spread = Math.max(last.high - last.low, Number.EPSILON);
  const clv =
    ((last.close - last.low) - (last.high - last.close)) / spread;
  const displacement: FlowDirection | null =
    spread > medianSpread * cfg.displacementRatio && Math.abs(clv) > 0.55
      ? direction(last.close - last.open)
      : null;

  const mss: FlowDirection | null =
    choch && displacement === choch ? choch : null;

  const liquidity = buildLiquidity(bars, allSwings, atr, cfg);

  const fvgs = detectFvgs(bars, cfg.maxZones);
  const orderBlocks = detectOrderBlocks(bars, allSwings, atr, cfg);

  const primaryFvg =
    fvgs.find((f) => f.status === "OPEN") ??
    fvgs.find((f) => f.status === "PARTIAL") ??
    fvgs[0] ??
    null;
  const primaryOb =
    orderBlocks.find((o) => o.status === "OPEN") ?? orderBlocks[0] ?? null;

  const rangeBars = bars.slice(-cfg.dealingRangeBars);
  let rangeHigh = Math.max(...rangeBars.map((b) => b.high));
  let rangeLow = Math.min(...rangeBars.map((b) => b.low));
  if (external.swingHigh != null && external.swingLow != null) {
    const extHighs = externalSwings.filter((s) => s.type === "high").slice(-3);
    const extLows = externalSwings.filter((s) => s.type === "low").slice(-3);
    if (extHighs.length && extLows.length) {
      rangeHigh = Math.max(...extHighs.map((s) => s.price));
      rangeLow = Math.min(...extLows.map((s) => s.price));
    }
  }
  const equilibrium = (rangeHigh + rangeLow) / 2;
  const rangeSize = Math.max(rangeHigh - rangeLow, Number.EPSILON);
  const premiumDiscount: MoneyFlowAnalysis["ict"]["premiumDiscount"] =
    last.close > equilibrium + atr * 0.1
      ? "PREMIUM"
      : last.close < equilibrium - atr * 0.1
        ? "DISCOUNT"
        : "EQUILIBRIUM";

  let ote: MoneyFlowAnalysis["ict"]["ote"] = null;
  if (primaryTrend === "bullish") {
    const oteHigh = rangeHigh - rangeSize * 0.62;
    const oteLow = rangeHigh - rangeSize * 0.79;
    ote = { low: oteLow, high: oteHigh, direction: "bullish" };
  } else if (primaryTrend === "bearish") {
    const oteLow = rangeLow + rangeSize * 0.62;
    const oteHigh = rangeLow + rangeSize * 0.79;
    ote = { low: oteLow, high: oteHigh, direction: "bearish" };
  }
  const inOte = ote != null && last.close >= ote.low && last.close <= ote.high;

  const shortVol = average(bars.slice(-10).map((b) => b.high - b.low));
  const longVol = average(bars.slice(-40).map((b) => b.high - b.low));
  const volatility = shortVol / Math.max(longVol, Number.EPSILON);
  const regime: MarketRegime =
    volatility > 1.6
      ? "HIGH_VOLATILITY"
      : volatility < 0.65
        ? "LOW_VOLATILITY"
        : primaryTrend === "bullish"
          ? "TREND_UP"
          : primaryTrend === "bearish"
            ? "TREND_DOWN"
            : choch
              ? "TRANSITION"
              : "RANGE";

  let vsaScore = 0;
  if (vsa.effortResult === "bullish") vsaScore += 22;
  if (vsa.effortResult === "bearish") vsaScore -= 22;
  if (vsa.absorption === "bullish") vsaScore += 14;
  if (vsa.absorption === "bearish") vsaScore -= 14;
  if (vsa.events.includes("NO_SUPPLY")) vsaScore += 8;
  if (vsa.events.includes("NO_DEMAND")) vsaScore -= 8;
  if (vsa.events.includes("STOPPING_VOLUME_BULLISH")) vsaScore += 10;
  if (vsa.events.includes("STOPPING_VOLUME_BEARISH")) vsaScore -= 10;
  if (vsa.events.includes("TEST_BULLISH")) vsaScore += 6;
  if (vsa.events.includes("TEST_BEARISH")) vsaScore -= 6;

  const structureScore =
    (external.bos === "bullish" ? 18 : external.bos === "bearish" ? -18 : 0) +
    (internal.bos === "bullish" ? 8 : internal.bos === "bearish" ? -8 : 0) +
    (mss === "bullish" ? 10 : mss === "bearish" ? -10 : 0);

  const liquidityScore =
    liquidity.sweep === "SELL_SIDE" ? 18 : liquidity.sweep === "BUY_SIDE" ? -18 : 0;

  let smcScore = 0;
  if (displacement === "bullish") smcScore += 12;
  if (displacement === "bearish") smcScore -= 12;
  if (primaryFvg?.direction === "bullish" && primaryFvg.status !== "FILLED") smcScore += 8;
  if (primaryFvg?.direction === "bearish" && primaryFvg.status !== "FILLED") smcScore -= 8;
  if (primaryOb?.direction === "bullish" && primaryOb.status === "OPEN") {
    smcScore += 6 + (primaryOb.hadLiquiditySweep ? 4 : 0) + (primaryOb.hasDisplacementFvg ? 3 : 0);
  }
  if (primaryOb?.direction === "bearish" && primaryOb.status === "OPEN") {
    smcScore -= 6 + (primaryOb.hadLiquiditySweep ? 4 : 0) + (primaryOb.hasDisplacementFvg ? 3 : 0);
  }

  let ictScore = 0;
  if (premiumDiscount === "DISCOUNT") ictScore += 5;
  if (premiumDiscount === "PREMIUM") ictScore -= 5;
  if (inOte && primaryTrend === "bullish") ictScore += 8;
  if (inOte && primaryTrend === "bearish") ictScore -= 8;

  const score = clamp(vsaScore + structureScore + liquidityScore + smcScore + ictScore);

  const dirs: FlowDirection[] = [
    vsa.effortResult,
    bos ?? "neutral",
    displacement ?? "neutral",
    liquidity.sweep === "SELL_SIDE" ? "bullish" : liquidity.sweep === "BUY_SIDE" ? "bearish" : "neutral",
    primaryFvg?.direction === "bullish"
      ? "bullish"
      : primaryFvg?.direction === "bearish"
        ? "bearish"
        : "neutral",
  ].filter((d) => d !== "neutral");

  const agreementBull = dirs.filter((d) => d === "bullish").length;
  const agreementBear = dirs.filter((d) => d === "bearish").length;
  const majority = score >= 0 ? "bullish" : "bearish";
  const aligned = majority === "bullish" ? agreementBull : agreementBear;

  const confidence = Math.round(
    Math.max(
      20,
      Math.min(
        95,
        40 +
          aligned * 10 +
          (vsa.rvol != null ? 6 : 0) +
          (mss ? 8 : 0) +
          (primaryOb?.hadLiquiditySweep ? 6 : 0) +
          (inOte ? 5 : 0) +
          (primaryFvg?.status === "OPEN" ? 4 : 0),
      ),
    ),
  );

  const state = resolveState({
    score,
    sweep: liquidity.sweep,
    mss,
    displacement,
    absorption: vsa.absorption,
    bos,
    effortResult: vsa.effortResult,
    premiumDiscount,
    vsaEvents: vsa.events,
    agreementBull,
    agreementBear,
  });

  return {
    score,
    confidence,
    state,
    regime,
    vsa,
    structure: {
      trend: primaryTrend,
      bos,
      choch,
      mss,
      swingHigh: external.swingHigh ?? internal.swingHigh,
      swingLow: external.swingLow ?? internal.swingLow,
      internal: {
        trend: internal.trend,
        bos: internal.bos,
        choch: internal.choch,
        swingHigh: internal.swingHigh,
        swingLow: internal.swingLow,
      },
      external: {
        trend: external.trend,
        bos: external.bos,
        choch: external.choch,
        swingHigh: external.swingHigh,
        swingLow: external.swingLow,
      },
      swings: allSwings.slice(-24),
    },
    liquidity: {
      sweep: liquidity.sweep,
      nearestBuySide: liquidity.nearestBuySide,
      nearestSellSide: liquidity.nearestSellSide,
      levels: liquidity.levels,
      recentSweeps: liquidity.recentSweeps,
      equalHighs: liquidity.equalHighs,
      equalLows: liquidity.equalLows,
    },
    smc: {
      displacement,
      fvg: primaryFvg
        ? {
            direction: primaryFvg.direction,
            low: primaryFvg.low,
            high: primaryFvg.high,
            status:
              primaryFvg.status === "FILLED"
                ? "FILLED"
                : primaryFvg.status === "PARTIAL"
                  ? "PARTIAL"
                  : "OPEN",
          }
        : null,
      orderBlock: primaryOb
        ? {
            direction: primaryOb.direction,
            low: primaryOb.low,
            high: primaryOb.high,
            status: primaryOb.status,
          }
        : null,
      fvgs,
      orderBlocks,
    },
    ict: {
      premiumDiscount,
      dealingRange: { high: rangeHigh, low: rangeLow },
      equilibrium,
      ote,
      inOte,
    },
  };
}
