import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAlert } from "../engines/alerts";

test("alerts: price_above / price_below against threshold", () => {
  assert.equal(evaluateAlert("price_above", 50, { price: 55 }).triggered, true);
  assert.equal(evaluateAlert("price_above", 50, { price: 45 }).triggered, false);
  assert.equal(evaluateAlert("price_below", 50, { price: 45 }).triggered, true);
  assert.equal(evaluateAlert("price_below", 50, { price: 55 }).triggered, false);
});

test("alerts: pct_change is absolute (either direction fires)", () => {
  assert.equal(evaluateAlert("pct_change", 3, { changePercent: 4.2 }).triggered, true);
  assert.equal(evaluateAlert("pct_change", 3, { changePercent: -4.2 }).triggered, true);
  assert.equal(evaluateAlert("pct_change", 3, { changePercent: -1 }).triggered, false);
});

test("alerts: rsi and volume_spike", () => {
  assert.equal(evaluateAlert("rsi", 70, { rsi: 74 }).triggered, true);
  assert.equal(evaluateAlert("rsi", 70, { rsi: 55 }).triggered, false);
  assert.equal(evaluateAlert("volume_spike", 2, { volumeRatio: 3.4 }).triggered, true);
  assert.equal(evaluateAlert("volume_spike", 2, { volumeRatio: 1.2 }).triggered, false);
});

test("alerts: missing data never triggers, always has a reason", () => {
  for (const c of ["price_above", "price_below", "pct_change", "rsi", "volume_spike"] as const) {
    const r = evaluateAlert(c, 10, {});
    assert.equal(r.triggered, false);
    assert.ok(r.reason);
    assert.equal(r.value, null);
  }
});

test("alerts: invalid threshold is rejected, not silently triggered", () => {
  const r = evaluateAlert("price_above", Number.NaN, { price: 100 });
  assert.equal(r.triggered, false);
  assert.match(r.reason ?? "", /không hợp lệ/);
});
