import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSmartRules, type SmartAlertInputs } from "../engines/smart-alerts";

const base: SmartAlertInputs = {
  indexChangePercent: 0.2,
  indexVolumeRatio: 1.1,
  advancers: 60,
  decliners: 40,
  total: 100,
  newHighs20: 0,
  newLows20: 0,
  sectorRotationScore: 10,
  topSector: null,
  topSectorChange: null,
  massMovers: [],
  volatilityRatio: 1.1,
};

test("smart alerts: breadth thrust (2.5x + index dương)", () => {
  const signals = evaluateSmartRules({ ...base, advancers: 75, decliners: 25, indexChangePercent: 0.5 });
  assert.ok(signals.some((s) => s.ruleId === "breadth_thrust" && s.severity === "watch"));
});

test("smart alerts: capitulation khi bán lan rộng", () => {
  const signals = evaluateSmartRules({ ...base, advancers: 20, decliners: 80, indexChangePercent: -0.8 });
  assert.ok(signals.some((s) => s.ruleId === "breadth_capitulation" && s.severity === "alert"));
});

test("smart alerts: volume surge + index breakout + rotation + mass movers cluster", () => {
  const signals = evaluateSmartRules({
    ...base,
    indexChangePercent: 1.2,
    indexVolumeRatio: 1.8,
    advancers: 70,
    decliners: 30,
    sectorRotationScore: 40,
    topSector: "Ngân hàng",
    topSectorChange: 1.1,
    massMovers: [
      { symbol: "A", sector: "Thép", changePercent: 6 },
      { symbol: "B", sector: "Thép", changePercent: 5.5 },
      { symbol: "C", sector: "Thép", changePercent: 5.2 },
    ],
  });
  assert.ok(signals.some((s) => s.ruleId === "index_volume_surge"));
  assert.ok(signals.some((s) => s.ruleId === "index_momentum_breakout"));
  assert.ok(signals.some((s) => s.ruleId === "sector_rotation_trigger"));
  assert.ok(signals.some((s) => s.ruleId === "mass_movers_sector"));
});

test("smart alerts: new highs surge + volatility expansion", () => {
  const signals = evaluateSmartRules({ ...base, newHighs20: 9, volatilityRatio: 1.7 });
  assert.ok(signals.some((s) => s.ruleId === "new_highs_surge"));
  assert.ok(signals.some((s) => s.ruleId === "volatility_expansion"));
});

test("smart alerts: không signal khi thị trường bình thường", () => {
  const signals = evaluateSmartRules(base);
  assert.equal(signals.length, 0);
});
