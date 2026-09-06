import test from "node:test";
import assert from "node:assert/strict";
import { classifySession, sessionFreshnessHint, vnSlasForSession, type VnSessionState } from "../vn/sessions";

test("sessions: business-day session windows (2026-09-07 is a Monday)", () => {
  const d = "2026-09-07";
  assert.equal(classifySession(d, 8 * 60, 1), "pre_open");
  assert.equal(classifySession(d, 9 * 60 + 5, 1), "opening_auction");
  assert.equal(classifySession(d, 9 * 60 + 16, 1), "morning_continuous");
  assert.equal(classifySession(d, 11 * 60 + 30, 1), "lunch_break");
  assert.equal(classifySession(d, 13 * 60, 1), "afternoon_continuous");
  assert.equal(classifySession(d, 14 * 60 + 35, 1), "closing_auction");
  assert.equal(classifySession(d, 14 * 60 + 50, 1), "post_trading");
  assert.equal(classifySession(d, 15 * 60 + 10, 1), "closed");
});

test("sessions: weekend and holiday are closed", () => {
  assert.equal(classifySession("2026-09-06", 10 * 60, 0), "weekend_closed"); // Sunday
  assert.equal(classifySession("2026-09-05", 10 * 60, 6), "weekend_closed"); // Saturday
  assert.equal(classifySession("2026-09-02", 10 * 60, 3), "holiday_closed"); // 2/9 National Day
});

test("sessions: freshness hints are always a non-empty string", () => {
  for (const s of ["pre_open", "morning_continuous", "closing_auction", "closed"] as const) {
    assert.ok(sessionFreshnessHint(s).length > 0);
  }
});

test("sessions: vnSlasForSession — trading tightest, pre-open/lunch mid, closed widest", () => {
  const s = (state: VnSessionState) => ({ state, labelVi: "", open: true, trading: state === "morning_continuous" || state === "afternoon_continuous" || state === "opening_auction" || state === "closing_auction", sessionDate: "2026-09-07", checkedAt: "" });
  const trading = vnSlasForSession(s("morning_continuous"));
  const lunch = vnSlasForSession(s("lunch_break"));
  const closed = vnSlasForSession(s("closed"));
  assert.ok(trading.freshSlaMs < lunch.freshSlaMs);
  assert.ok(lunch.freshSlaMs < closed.freshSlaMs);
  assert.ok(closed.freshSlaMs === 24 * 3_600_000);
});
