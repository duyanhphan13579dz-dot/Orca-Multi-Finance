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
