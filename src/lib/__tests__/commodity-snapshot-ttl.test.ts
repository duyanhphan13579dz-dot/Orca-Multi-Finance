import test from "node:test";
import assert from "node:assert/strict";
import { parseBoundedIntEnv } from "../env";
import { env } from "../env";

test("snapshot TTL: parseBoundedIntEnv dùng fallback khi thiếu/rác", () => {
  assert.equal(parseBoundedIntEnv(undefined, 3_000, 2_000, 300_000), 3_000);
  assert.equal(parseBoundedIntEnv("", 3_000, 2_000, 300_000), 3_000);
  assert.equal(parseBoundedIntEnv("  ", 3_000, 2_000, 300_000), 3_000);
  assert.equal(parseBoundedIntEnv("abc", 3_000, 2_000, 300_000), 3_000);
  assert.equal(parseBoundedIntEnv("NaN", 3_000, 2_000, 300_000), 3_000);
});

test("snapshot TTL: parse hợp lệ và clamp min/max", () => {
  assert.equal(parseBoundedIntEnv("3000", 3_000, 2_000, 300_000), 3_000);
  assert.equal(parseBoundedIntEnv("1000", 3_000, 2_000, 300_000), 2_000); // floor
  assert.equal(parseBoundedIntEnv("999999999", 3_000, 2_000, 300_000), 300_000); // cap
  assert.equal(parseBoundedIntEnv("3500.9", 3_000, 2_000, 300_000), 3_500); // floor() float
  assert.equal(parseBoundedIntEnv("-5", 3_000, 2_000, 300_000), 2_000);
});

test("snapshot TTL: mặc định env = 3000ms (poll 3s theo yêu cầu)", () => {
  assert.equal(env.commoditySnapshotTtlMs, 3_000);
});
