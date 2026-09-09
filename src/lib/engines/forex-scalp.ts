import "server-only";
import type { OhlcvBar } from "../types";
import { atr, supportResistance } from "../technical";
import type { ForexScalpInput, ForexScalpSetup, ForexScalpSignal } from "./forex-scalp-types";
import {
  detectForexRegime,
  pipSize,
  runForexFilter,
  strategyA,
  strategyB,
  strategyC,
  strategyTech,
  toPips,
} from "./forex-scalp-modules";

export type {
  ForexTier,
  ForexVolatilityRegime,
  ForexMarketRegime,
  ForexScalpDirection,
  ForexSetupStatus,
  ForexScalpSetup,
  ForexFilterResult,
  ForexRegimeSnapshot,
  ForexScalpSignal,
  ForexScalpInput,
} from "./forex-scalp-types";

export { pipSize, toPips, sessionInfo, classifyForexTier } from "./forex-scalp-modules";

/** Guaranteed levels from regime bias + ATR — always fills Entry/SL/TP. */
function regimeFallbackSetup(
  pair: string,
  bars: OhlcvBar[],
  regime: ReturnType<typeof detectForexRegime>,
  sessionSoft: number,
): ForexScalpSetup | null {
  if (bars.length < 20) return null;
  const last = bars[bars.length - 1];
  const entry = last.close;
  const atrV = atr(bars, 14) ?? Math.max(last.high - last.low, pipSize(pair) * 8);
  const stopDist = Math.max(atrV * 1.0, pipSize(pair) * 6);
  const rr = 1.5;

  let direction: ForexScalpSetup["direction"] = "NONE";
  if (regime.market === "TRENDING_UP") direction = "BUY";
  else if (regime.market === "TRENDING_DOWN") direction = "SELL";
  else {
    // Ranging / unknown: use last candle bias
    direction = last.close >= last.open ? "BUY" : "SELL";
  }
  if (direction === "NONE") return null;

  const stopLoss = direction === "BUY" ? entry - stopDist : entry + stopDist;
  const takeProfit = direction === "BUY" ? entry + stopDist * rr : entry - stopDist * rr;
  const baseStrength = regime.market === "RANGING" ? 28 : 38;
  const strength = Math.max(12, Math.round(baseStrength * sessionSoft));

  return {
    strategy: "A",
    direction,
    status: "ACTIVE",
    strength,
    entry,
    stopLoss,
    takeProfit,
    riskReward: rr,
    invalidation: stopLoss,
    entryZone: direction === "BUY" ? [stopLoss, entry] : [entry, stopLoss],
    stopPips: toPips(pair, stopDist),
    evidence: [
      `Fallback regime ${regime.market} → ${direction}`,
      `ATR-based levels | SL ${toPips(pair, stopDist).toFixed(1)} pip | RR ${rr}`,
      "Minh họa kỹ thuật — chưa đủ confluence pattern/breakout",
    ],
    riskNotes: [
      "Mức giá fallback theo regime + ATR",
      sessionSoft < 1 ? "Ngoài phiên chính — giảm size" : "Kiểm tra spread trước khi vào",
    ],
  };
}

/**
 * Multi-TF forex scalping per M15→M5→M1 + technical/pattern confluence.
 * Session is a soft gate (strength discount) — hard blocks only on spread/data/excluded.
 * Always attempts to surface Entry/SL/TP via regime fallback when no strategy fires.
 */
export function analyzeForexScalp(input: ForexScalpInput): ForexScalpSignal | null {
  if (input.barsM5.length < 40) return null;
  const pair = input.pair.toUpperCase().replace("/", "");
  const filter = runForexFilter(input);
  const regime = detectForexRegime(input.barsM15.length >= 30 ? input.barsM15 : input.barsM5, pair);
  const last = input.barsM5[input.barsM5.length - 1]?.close ?? 0;
  const atrV = atr(input.barsM5, 14);
  const pip = pipSize(pair);

  const sessionSoft =
    filter.sessionLabel === "WEEKEND"
      ? 0.35
      : filter.sessionLabel === "ROLLOVER"
        ? 0.55
        : filter.sessionLabel === "OFF_SESSION"
          ? 0.7
          : 1;

  const activeSetups: ForexScalpSetup[] = [];
  let moduleBStatus: "AVAILABLE" | "ORDER_FLOW_UNAVAILABLE" = "ORDER_FLOW_UNAVAILABLE";
  const m15 = input.barsM15.length ? input.barsM15 : input.barsM5;

  // Always attempt strategies when we have bars (even soft session / hard filter partially)
  if (regime.market !== "CHAOTIC") {
    if (filter.eligible || filter.spreadOk) {
      const a = strategyA(pair, m15, input.barsM5, input.barsM1, regime);
      if (a) {
        if (sessionSoft < 1) {
          a.strength = Math.round(a.strength * sessionSoft);
          a.riskNotes = [...a.riskNotes, `Session ${filter.sessionLabel} — giảm strength`];
        }
        activeSetups.push(a);
      }

      const c = strategyC(pair, m15, input.barsM5, regime);
      if (c) {
        if (sessionSoft < 1) {
          c.strength = Math.round(c.strength * sessionSoft);
          c.riskNotes = [...c.riskNotes, `Session ${filter.sessionLabel} — giảm strength`];
        }
        activeSetups.push(c);
      }

      const tech = strategyTech(pair, input.barsM5, m15, regime, sessionSoft);
      if (tech) activeSetups.push(tech);

      if (regime.market === "RANGING") {
        const b = strategyB(pair, input.barsM5, regime);
        moduleBStatus = b.status;
        if (b.setup && b.setup.direction !== "NONE") activeSetups.push(b.setup);
      }
    }
  }

  // Guaranteed levels so UI never shows empty Entry/SL/TP when data exists
  const hasLevels = activeSetups.some((s) => s.entry != null && s.stopLoss != null && s.direction !== "NONE");
  if (!hasLevels && regime.market !== "CHAOTIC") {
    const fb = regimeFallbackSetup(pair, input.barsM5, regime, sessionSoft);
    if (fb) activeSetups.push(fb);
  }

  if (activeSetups.length === 0) {
    activeSetups.push({
      strategy: "A",
      direction: "NONE",
      status: regime.market === "CHAOTIC" ? "NO_SETUP" : "FILTERED_OUT",
      strength: 0,
      entry: null,
      stopLoss: null,
      takeProfit: null,
      riskReward: null,
      invalidation: null,
      entryZone: null,
      stopPips: null,
      evidence: regime.market === "CHAOTIC" ? ["CHAOTIC regime — khong scalp"] : filter.reasons,
      riskNotes: regime.market === "CHAOTIC" ? ["Khoa giao dich"] : ["Filter chan entry"],
    });
  }

  const ranked = [...activeSetups].sort((x, y) => {
    const lx = x.entry != null && x.stopLoss != null && x.direction !== "NONE" ? 1 : 0;
    const ly = y.entry != null && y.stopLoss != null && y.direction !== "NONE" ? 1 : 0;
    if (lx !== ly) return ly - lx;
    return y.strength - x.strength;
  });

  const primarySetup =
    ranked.find((s) => s.status === "TRIGGERED" && s.entry != null) ??
    ranked.find((s) => s.entry != null && s.direction !== "NONE") ??
    ranked.find((s) => s.status === "AWAITING_M1_RETEST" || s.status === "AWAITING_M5_BREAKOUT") ??
    ranked[0] ??
    null;

  let direction: ForexScalpSignal["direction"] = "neutral";
  let strength = 0;
  if (
    primarySetup?.direction === "BUY" &&
    primarySetup.status !== "INVALIDATED" &&
    primarySetup.status !== "FILTERED_OUT"
  ) {
    direction = "watch-long";
    strength = primarySetup.strength;
  } else if (
    primarySetup?.direction === "SELL" &&
    primarySetup.status !== "INVALIDATED" &&
    primarySetup.status !== "FILTERED_OUT"
  ) {
    direction = "watch-short";
    strength = primarySetup.strength;
  }

  const riskNotes = [
    ...filter.reasons.filter((r) => !r.startsWith("Pass") && !r.startsWith("Soft")),
    ...regime.evidence,
    ...(primarySetup?.riskNotes ?? []),
  ];

  const evidence = [
    `Filter: tier ${filter.tier} | ${filter.sessionLabel} | spread ${filter.spreadPips?.toFixed(1) ?? "n/a"}/${filter.maxSpreadPips} pip`,
    `Regime: ${regime.market} / ${regime.volatility}`,
    ...(primarySetup?.evidence ?? []).slice(0, 5),
  ];

  const micro = supportResistance((input.barsM15.length >= 40 ? input.barsM15 : input.barsM5).slice(-96), 96);

  return {
    pair,
    timeframe: "M15->M5->M1",
    direction,
    strength,
    score: Number((strength / 33).toFixed(2)),
    last,
    pipSize: pip,
    atr: atrV,
    atrPips: atrV != null ? toPips(pair, atrV) : null,
    entryZone: primarySetup?.entryZone ?? null,
    invalidation: primarySetup?.invalidation ?? null,
    micro,
    riskNotes: [...new Set(riskNotes)].slice(0, 8),
    evidence: evidence.slice(0, 8),
    filter,
    regime,
    activeSetups,
    primarySetup,
    moduleBStatus,
    riskHint: {
      recommendedRiskPct: sessionSoft < 1 ? 0.15 : 0.25,
      stopPips: primarySetup?.stopPips ?? null,
      note: "lot = risk_amount / (stop_pips × pip_value) — kiem tra margin & correlation USD. Khong phai khuyen nghi.",
    },
  };
}

export function analyzeForexScalpSimple(pair: string, bars: OhlcvBar[]): ForexScalpSignal | null {
  if (bars.length < 40) return null;
  return analyzeForexScalp({
    pair,
    barsM15: bars,
    barsM5: bars,
    barsM1: null,
  });
}
