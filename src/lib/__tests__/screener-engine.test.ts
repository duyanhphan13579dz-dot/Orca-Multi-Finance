import test from "node:test";
import assert from "node:assert/strict";
import { filterAndSortRows } from "../engines/screener";

const rows = [
  { symbol: "A", changePercent: 5, quoteVolume: 10 },
  { symbol: "B", changePercent: -3, quoteVolume: 100 },
  { symbol: "C", changePercent: 1, quoteVolume: 50 },
  { symbol: "D", changePercent: 8, quoteVolume: 1 },
];

test("screener: min/max change filters", () => {
  const out = filterAndSortRows(rows, { minChange: 0, maxChange: 5 });
  assert.deepEqual(out.map((r) => r.symbol).sort(), ["A", "C"]);
});

test("screener: min quote volume filters", () => {
  const out = filterAndSortRows(rows, { minQuoteVolume: 40 });
  assert.deepEqual(out.map((r) => r.symbol).sort(), ["B", "C"]);
});

test("screener: gainers/losers/volume sorts", () => {
  assert.deepEqual(filterAndSortRows(rows, { sort: "gainers" }).map((r) => r.symbol), ["D", "A", "C", "B"]);
  assert.deepEqual(filterAndSortRows(rows, { sort: "losers" }).map((r) => r.symbol), ["B", "C", "A", "D"]);
  assert.deepEqual(filterAndSortRows(rows, { sort: "volume" }).map((r) => r.symbol), ["B", "C", "A", "D"]);
});

test("screener: limit caps and is at least 1", () => {
  assert.equal(filterAndSortRows(rows, { limit: 2 }).length, 2);
  assert.equal(filterAndSortRows(rows, { limit: 0 }).length, 1);
});

test("screener: missing values treated as 0 (never crash)", () => {
  const out = filterAndSortRows([{ symbol: "X" }, { symbol: "Y", changePercent: -99 }], { minChange: 0 });
  assert.deepEqual(out.map((r) => r.symbol), ["X"]);
});
