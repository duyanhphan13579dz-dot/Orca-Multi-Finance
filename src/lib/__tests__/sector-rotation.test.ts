import test from "node:test";
import assert from "node:assert/strict";
import { computeSectorRotation } from "../engines/sector-rotation";

const s = (symbol: string, sector: string, changePercent: number, quoteVolume = 1000) => ({ symbol, sector, changePercent, quoteVolume });

test("sector rotation: median per sector, participation, volume share, RS", () => {
  const r = computeSectorRotation([
    s("A", "Ngân hàng", 1.5, 2000),
    s("B", "Ngân hàng", 2.5, 1000),
    s("C", "Ngân hàng", -0.5, 500),
    s("D", "Thép", -1, 1500),
    s("E", "Thép", -2, 500),
  ]);
  const bank = r.rows.find((x) => x.sector === "Ngân hàng");
  const steel = r.rows.find((x) => x.sector === "Thép");
  assert.ok(bank && steel);
  assert.equal(bank.medianChangePct, 1.5); // median, không phải average 1.17
  assert.equal(bank.advancers, 2);
  assert.equal(bank.participationRatio, 0.667);
  assert.equal(bank.volumeSharePct, Number(((3500 / 5500) * 100).toFixed(1)));
  assert.equal(bank.label, "leading");
  assert.equal(steel.label, "lagging");
  assert.equal(r.topSector, "Ngân hàng");
  assert.equal(r.laggardSector, "Thép");
  assert.ok(r.dispersionPct > 0);
});

test("sector rotation: market median + relative strength đúng dấu", () => {
  const r = computeSectorRotation([
    s("A", "X", 2, 1000),
    s("B", "Y", 0, 1000),
    s("C", "X", 2, 1000),
  ]);
  assert.equal(r.marketMedianChangePct, 2);
  const y = r.rows.find((x) => x.sector === "Y");
  assert.ok(y);
  assert.ok(y.relativeStrength < 0);
});
