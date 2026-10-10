import test from "node:test";
import assert from "node:assert/strict";
import { analyzeCanslim } from "../engines/canslim";

test("CANSLIM không pass M khi chưa xác định được hướng VNINDEX", () => {
  const snapshot = analyzeCanslim({
    bars: [],
    growth: null,
    health: null,
    marketBullish: null,
  });

  const market = snapshot.letters.find((letter) => letter.letter === "M");
  assert.ok(market);
  assert.equal(market.pass, false);
  assert.match(market.detail, /chưa xác định|chưa đạt/i);
  assert.ok(snapshot.flags.some((flag) => flag.startsWith("M:")));
});

test("CANSLIM chỉ pass M khi marketBullish=true", () => {
  const snapshot = analyzeCanslim({
    bars: [],
    growth: null,
    health: null,
    marketBullish: true,
    marketDetail: "VNINDEX trên MA50",
  });

  const market = snapshot.letters.find((letter) => letter.letter === "M");
  assert.ok(market);
  assert.equal(market.pass, true);
  assert.equal(market.detail, "VNINDEX trên MA50");
});

test("CANSLIM letter C pass khi tăng trưởng LN ròng > 300% (raw ratio = 4.0 -> 400%)", () => {
  const snapshot = analyzeCanslim({
    bars: [],
    growth: {
      yoy: [{ metric: "netIncome", current: 500, prior: 100, changePct: 4, currentPeriod: "Q4-2025", priorPeriod: "Q4-2024" }],
      qoq: [],
      latestPeriod: "Q4-2025",
      priorYearPeriod: "Q4-2024",
      priorQuarterPeriod: null,
    },
    health: null,
    marketBullish: true,
  });

  const c = snapshot.letters.find((letter) => letter.letter === "C");
  assert.ok(c);
  assert.equal(c.pass, true);
  assert.match(c.detail, /400%/);
});

test("CANSLIM letter A tính đúng CAGR khi periods chứa bản ghi trùng năm", () => {
  const snapshot = analyzeCanslim({
    bars: [],
    growth: null,
    health: null,
    periods: [
      { periodType: "year", year: 2022, metrics: { netIncome: 100 } } as any,
      { periodType: "year", year: 2022, metrics: { netIncome: 100 } } as any, // duplicate filing
      { periodType: "year", year: 2024, metrics: { netIncome: 144 } } as any, // 2 years span: sqrt(144/100) - 1 = 20%
    ],
    marketBullish: true,
  });

  const a = snapshot.letters.find((letter) => letter.letter === "A");
  assert.ok(a);
  assert.equal(a.pass, true);
  assert.match(a.detail, /20%/);
});

