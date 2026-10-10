import assert from "node:assert/strict";
import test from "node:test";
import {
  getMarketSession,
  getRecommendedPollInterval,
  getVnDateTime,
  shouldIngest,
} from "../data-engine/scheduler";

test("getVnDateTime: converts timestamp to UTC+7 correctly", () => {
  // 2026-10-12 09:30:00 UTC+7 is 2026-10-12 02:30:00 UTC (Monday)
  const epoch = Date.UTC(2026, 9, 12, 2, 30, 0);
  const vn = getVnDateTime(epoch);
  assert.equal(vn.year, 2026);
  assert.equal(vn.month, 10);
  assert.equal(vn.date, 12);
  assert.equal(vn.hour, 9);
  assert.equal(vn.minute, 30);
  assert.equal(vn.dayOfWeek, 1); // Monday
});

test("getMarketSession: identifies sessions correctly on a weekday", () => {
  // Monday 2026-10-12
  // Pre-market: 8:45 VN -> 01:45 UTC
  const preEpoch = Date.UTC(2026, 9, 12, 1, 45, 0);
  assert.equal(getMarketSession(preEpoch).session, "PRE_MARKET");

  // ATO: 9:05 VN -> 02:05 UTC
  const atoEpoch = Date.UTC(2026, 9, 12, 2, 5, 0);
  const ato = getMarketSession(atoEpoch);
  assert.equal(ato.session, "ATO");
  assert.equal(ato.isOpen, true);
  assert.equal(ato.isAuction, true);

  // Continuous Morning: 10:15 VN -> 03:15 UTC
  const contEpoch = Date.UTC(2026, 9, 12, 3, 15, 0);
  const cont = getMarketSession(contEpoch);
  assert.equal(cont.session, "CONTINUOUS_MORNING");
  assert.equal(cont.isOpen, true);
  assert.equal(cont.isContinuous, true);

  // Lunch: 12:00 VN -> 05:00 UTC
  const lunchEpoch = Date.UTC(2026, 9, 12, 5, 0, 0);
  assert.equal(getMarketSession(lunchEpoch).session, "LUNCH_INTERMISSION");

  // Continuous Afternoon: 13:45 VN -> 06:45 UTC
  const aftEpoch = Date.UTC(2026, 9, 12, 6, 45, 0);
  assert.equal(getMarketSession(aftEpoch).session, "CONTINUOUS_AFTERNOON");

  // ATC: 14:35 VN -> 07:35 UTC
  const atcEpoch = Date.UTC(2026, 9, 12, 7, 35, 0);
  const atc = getMarketSession(atcEpoch);
  assert.equal(atc.session, "ATC");
  assert.equal(atc.isAuction, true);

  // Closed: 16:00 VN -> 09:00 UTC
  const closedEpoch = Date.UTC(2026, 9, 12, 9, 0, 0);
  assert.equal(getMarketSession(closedEpoch).session, "CLOSED");
});

test("getMarketSession: returns CLOSED on weekends", () => {
  // Sunday 2026-10-11 10:00 VN
  const sunEpoch = Date.UTC(2026, 9, 11, 3, 0, 0);
  const sun = getMarketSession(sunEpoch);
  assert.equal(sun.session, "CLOSED");
  assert.equal(sun.isOpen, false);
});

test("getRecommendedPollInterval: adjusts intervals by asset class", () => {
  // Crypto is always 15s
  assert.equal(getRecommendedPollInterval("crypto"), 15_000);
  // Financial statement is low frequency (1 hour)
  assert.equal(getRecommendedPollInterval("financial"), 3600_000);
});

test("shouldIngest: respects intervals and fresh SLA boundaries", () => {
  const now = Date.UTC(2026, 9, 12, 3, 0, 0); // Monday 10:00 AM VN
  // Initial fetch: always executes
  assert.equal(shouldIngest("vndirect", null, now).execute, true);

  // 2 seconds ago during continuous market (interval is 10s): skips
  const recent = shouldIngest("vndirect", now - 2_000, now);
  assert.equal(recent.execute, false);
  assert.equal(recent.reason, "WITHIN_INTERVAL");

  // 12 seconds ago: executes
  const due = shouldIngest("vndirect", now - 12_000, now);
  assert.equal(due.execute, true);
  assert.equal(due.reason, "INTERVAL_ELAPSED");

  // Stale age (> freshSlaMs 60s): executes
  const stale = shouldIngest("vndirect", now - 70_000, now);
  assert.equal(stale.execute, true);
  assert.equal(stale.reason, "FRESH_SLA_EXCEEDED");
});
