import assert from "node:assert/strict";
import test from "node:test";
import {
  getAllSourcesTelemetry,
  getSourceTelemetry,
  recordSourceTelemetry,
  resetTelemetryState,
} from "../data-engine/telemetry";

test("telemetry: records calls and computes accurate performance metrics", () => {
  resetTelemetryState();

  // Initially idle
  const idle = getSourceTelemetry("binance");
  assert.equal(idle.health, "IDLE");
  assert.equal(idle.totalCalls, 0);

  // Record 5 calls: 4 successes (50ms, 60ms, 70ms, 80ms) and 1 failure (200ms)
  recordSourceTelemetry({ sourceId: "binance", durationMs: 50, success: true });
  recordSourceTelemetry({ sourceId: "binance", durationMs: 60, success: true });
  recordSourceTelemetry({ sourceId: "binance", durationMs: 70, success: true });
  recordSourceTelemetry({ sourceId: "binance", durationMs: 80, success: true });
  recordSourceTelemetry({
    sourceId: "binance",
    durationMs: 200,
    success: false,
    statusCode: 500,
    error: "Connection reset",
  });

  const stats = getSourceTelemetry("binance");
  assert.equal(stats.totalCalls, 5);
  assert.equal(stats.successCalls, 4);
  assert.equal(stats.failedCalls, 1);
  assert.equal(stats.successRate, 80);
  assert.equal(stats.minDurationMs, 50);
  assert.equal(stats.maxDurationMs, 200);
  assert.equal(stats.lastStatusCode, 500);
  assert.equal(stats.lastError, "Connection reset");
  assert.ok(stats.avgDurationMs > 0);
  assert.ok(stats.p95DurationMs >= 80);
});

test("getAllSourcesTelemetry: aggregates health status across catalog", () => {
  resetTelemetryState();

  const all = getAllSourcesTelemetry();
  assert.ok(all.totalSources > 20);
  assert.equal(all.idleCount, all.totalSources);

  // Record healthy calls for vndirect
  for (let i = 0; i < 5; i++) {
    recordSourceTelemetry({ sourceId: "vndirect", durationMs: 40, success: true });
  }

  const updated = getAllSourcesTelemetry();
  assert.ok(updated.healthyCount >= 1);
  assert.equal(updated.sources.vndirect?.health, "HEALTHY");
});
