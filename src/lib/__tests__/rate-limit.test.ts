import test from "node:test";
import assert from "node:assert/strict";
import { takeRateLimit, rateLimitRemaining, resetRateLimits } from "../rate-limit";

test("rate-limit: allows up to N attempts, then blocks", () => {
  resetRateLimits();
  const key = "login:1.2.3.4:a@b.c";
  for (let i = 0; i < 5; i++) assert.equal(takeRateLimit(key, 5, 60_000, 1_000), true);
  assert.equal(takeRateLimit(key, 5, 60_000, 1_100), false);
  assert.equal(rateLimitRemaining(key, 5, 1_100), 0);
});

test("rate-limit: window resets after expiry", () => {
  resetRateLimits();
  const key = "login:ip:x";
  assert.equal(takeRateLimit(key, 2, 60_000, 1_000), true);
  assert.equal(takeRateLimit(key, 2, 60_000, 2_000), true);
  assert.equal(takeRateLimit(key, 2, 60_000, 3_000), false);
  // window elapsed → fresh bucket
  assert.equal(takeRateLimit(key, 2, 60_000, 61_000), true);
});

test("rate-limit: keys are independent", () => {
  resetRateLimits();
  assert.equal(takeRateLimit("a", 1, 60_000, 1_000), true);
  assert.equal(takeRateLimit("a", 1, 60_000, 2_000), false);
  assert.equal(takeRateLimit("b", 1, 60_000, 2_000), true);
});
