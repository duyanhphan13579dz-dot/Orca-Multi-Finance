import test from "node:test";
import assert from "node:assert/strict";
import { computeQuoteConfidence, computeBarConfidence, aggregateConfidence, levelOf } from "../confidence";

test("confidence: two agreeing providers → high", () => {
  const c = computeQuoteConfidence({
    providerCount: 2,
    deviationPct: 0.1,
    quality: "VALID",
    ageMs: 5_000,
    validSlaMs: 3 * 60_000,
    providerHealthy: true,
  });
  assert.equal(c.level, "high");
  assert.ok(c.score >= 0.85);
  assert.ok(c.factors.some((f) => f.includes("khớp")));
});

test("confidence: single provider maxes at medium (never high without cross-check)", () => {
  const c = computeQuoteConfidence({
    providerCount: 1,
    deviationPct: null,
    quality: "VALID",
    ageMs: 1_000,
    validSlaMs: 3 * 60_000,
    providerHealthy: true,
  });
  assert.equal(c.level, "medium");
  assert.ok(c.score <= 0.85);
});

test("confidence: two providers disagree → medium + factor, not average", () => {
  const c = computeQuoteConfidence({
    providerCount: 2,
    deviationPct: 2.5,
    quality: "VALID",
    ageMs: 5_000,
    validSlaMs: 3 * 60_000,
    providerHealthy: true,
  });
  assert.ok(c.level !== "high");
  assert.ok(c.factors.some((f) => f.includes("lệch lớn")));
});

test("confidence: stale/old data + fallback → low", () => {
  const c = computeQuoteConfidence({
    providerCount: 1,
    deviationPct: null,
    quality: "STALE",
    ageMs: 20 * 60_000,
    validSlaMs: 3 * 60_000,
    providerHealthy: false,
    secondaryOnly: true,
  });
  assert.ok(c.score < 0.55);
});

test("confidence: bar confidence — archive fallback never high, gaps lower score", () => {
  const primary = computeBarConfidence({ quality: "VALID", gapRatio: 0, source: "primary", barCount: 250, historySufficient: true });
  const archive = computeBarConfidence({ quality: "VALID", gapRatio: 0.3, source: "archive", barCount: 40, historySufficient: false });
  assert.equal(primary.level, "high");
  assert.ok(archive.score < primary.score);
  assert.notEqual(archive.level, "high");
});

test("confidence: aggregateConfidence → worst-of (low thắng medium, medium thắng high)", () => {
  const a = computeQuoteConfidence({ providerCount: 2, deviationPct: 0.1, quality: "VALID", ageMs: 1000, validSlaMs: 60_000, providerHealthy: true }); // high
  const b = computeQuoteConfidence({ providerCount: 1, deviationPct: null, quality: "VALID", ageMs: 15 * 60_000, validSlaMs: 60_000, providerHealthy: false }); // low
  assert.equal(a.level, "high");
  assert.equal(b.level, "low");
  const agg = aggregateConfidence([a, b]);
  assert.ok(agg);
  assert.equal(agg.level, "low");
  assert.equal(aggregateConfidence([]), null);
  // same level → lower score wins
  const c = computeQuoteConfidence({ providerCount: 1, deviationPct: null, quality: "VALID", ageMs: 10_000, validSlaMs: 60_000, providerHealthy: true }); // medium .8
  const d = computeQuoteConfidence({ providerCount: 1, deviationPct: null, quality: "SUSPECT", ageMs: 10_000, validSlaMs: 60_000, providerHealthy: true }); // medium .65
  assert.equal(aggregateConfidence([c, d])?.score, d.score);
});

test("confidence: levelOf thresholds", () => {
  assert.equal(levelOf(0.9), "high");
  assert.equal(levelOf(0.7), "medium");
  assert.equal(levelOf(0.4), "low");
  assert.equal(levelOf(0.1), "unverified");
});
