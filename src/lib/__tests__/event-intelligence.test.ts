import test from "node:test";
import assert from "node:assert/strict";
import { detectMarketEvents, type EventInputs } from "../engines/event-intelligence";

const base: EventInputs = {
  indexChangePercent: 0.1,
  indexVolumeRatio: 1.0,
  advancers: 55,
  decliners: 45,
  total: 100,
  newHighs20: 2,
  newLows20: 2,
  topSector: null,
  sectorDispersionPct: 10,
  massMovers: [],
  volatilityRatio: 1.0,
  ts: 1_700_000_000_000,
};

test("events: index breakdown + sector rotation + breadth extreme", () => {
  const events = detectMarketEvents({
    ...base,
    indexChangePercent: -1.5,
    advancers: 20,
    decliners: 80,
    sectorDispersionPct: 45,
    topSector: "Dầu khí",
  });
  const ids = events.map((e) => e.type);
  assert.ok(ids.includes("index_breakdown"));
  assert.ok(ids.includes("sector_rotation"));
  assert.ok(ids.includes("breadth_extreme"));
  const breakdown = events.find((e) => e.type === "index_breakdown");
  assert.equal(breakdown?.severity, "critical");
});

test("events: mass movers cluster gắn relatedSymbols + affectedSector", () => {
  const events = detectMarketEvents({
    ...base,
    massMovers: [
      { symbol: "A", sector: "Thép", changePercent: 6, volumeRatio: 2 },
      { symbol: "B", sector: "Thép", changePercent: 5.1, volumeRatio: 1.5 },
      { symbol: "C", sector: "Thép", changePercent: 5, volumeRatio: 1.2 },
    ],
  });
  const e = events.find((x) => x.type === "mass_movers");
  assert.ok(e);
  assert.equal(e.affectedSector, "Thép");
  assert.ok(e.relatedSymbols.includes("A"));
});

test("events: new highs surge + dedupe id theo cửa sổ 5 phút", () => {
  const e1 = detectMarketEvents({ ...base, newHighs20: 10 }, 1_700_000_000_000);
  const e2 = detectMarketEvents({ ...base, newHighs20: 10 }, 1_700_000_010_000); // +10s — cùng cửa sổ
  const h1 = e1.filter((e) => e.type === "new_highs");
  const h2 = e2.filter((e) => e.type === "new_highs");
  assert.equal(h1[0].id, h2[0].id); // một sự kiện trong 5 phút
});

test("events: volatility expansion + index breakout có severity hợp lý", () => {
  const events = detectMarketEvents({ ...base, indexChangePercent: 1.2, volatilityRatio: 1.8 });
  assert.ok(events.some((e) => e.type === "index_breakout" && e.severity === "watch"));
  assert.ok(events.some((e) => e.type === "volatility_expansion" && e.severity === "info"));
});
