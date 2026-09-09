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

/**
 * Multi-TF forex scalping per M15→M5→M1 + technical/pattern confluence.
 * Session is a soft gate (strength discount) — hard blocks only on spread/data/excluded.
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

  if (filter.eligible && regime.market !== "CHAOTIC") {
    const m15 = input.barsM15.length ? input.barsM15 : input.barsM5;

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
      if (b.setup) activeSetups.push(b.setup);
    }
  } else if (!filter.eligible) {
    // Still try technical read for illustration when only soft issues remain impossible
    const m15 = input.barsM15.length ? input.barsM15 : input.barsM5;
    const tech = strategyTech(pair, input.barsM5, m15, regime, 0.45);
    if (tech) {
      tech.riskNotes = [...tech.riskNotes, ...filter.reasons.filter((r) => !r.startsWith("Pass") && !r.startsWith("Soft"))];
      activeSetups.push(tech);
    } else {
      activeSetups.push({
        strategy: "A",
        direction: "NONE",
        status: "FILTERED_OUT",
        strength: 0,
        entry: null,
        stopLoss: null,
        takeProfit: null,
        riskReward: null,
        invalidation: null,
        entryZone: null,
        stopPips: null,
        evidence: filter.reasons,
        riskNotes: ["Filter chan entry"],
      });
    }
  } else {
    activeSetups.push({
      strategy: "A",
      direction: "NONE",
      status: "NO_SETUP",
      strength: 0,
      entry: null,
      stopLoss: null,
      takeProfit: null,
      riskReward: null,
      invalidation: null,
      entryZone: null,
      stopPips: null,
      evidence: ["CHAOTIC regime — khong scalp"],
      riskNotes: ["Khoa giao dich"],
    });
  }

  const ranked = [...activeSetups].sort((x, y) => {
    // Prefer setups that already have concrete levels
    const lx = x.entry != null && x.stopLoss != null ? 1 : 0;
    const ly = y.entry != null && y.stopLoss != null ? 1 : 0;
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
