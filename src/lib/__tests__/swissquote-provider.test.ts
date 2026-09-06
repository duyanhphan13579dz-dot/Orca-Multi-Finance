/**
 * SWISSQUOTE PUBLIC BBO PROVIDER — parse thật (fixture chụp live 2026-09-06),
 * chọn profile spread nhỏ nhất, từ chối payload rác (không suy diễn giá).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseSqBody, pickBestSqProfile, parseSqVenue } from "../providers/swissquote";

const XAU_FIXTURE = [
  {
    topo: { platform: "SwissquoteLtd", server: "Live5" },
    spreadProfilePrices: [
      { spreadProfile: "premium", bidSpread: 25.6, askSpread: 25.6, bid: 4430.579, ask: 4431.241 },
      { spreadProfile: "prime", bidSpread: 24.2, askSpread: 24.2, bid: 4430.593, ask: 4431.227 },
      { spreadProfile: "elite", bidSpread: 17.7, askSpread: 17.7, bid: 4430.658, ask: 4431.162 },
    ],
    ts: 1788555600090,
  },
  {
    topo: { platform: "AT", server: "AT" },
    spreadProfilePrices: [
      { spreadProfile: "standard", bidSpread: 27.0, askSpread: 27.0, bid: 4430.565, ask: 4431.255 },
      { spreadProfile: "premium", bidSpread: 25.65, askSpread: 25.65, bid: 4430.579, ask: 4431.242 },
    ],
    ts: 1788555600090,
  },
];

test("parseSqBody: chọn venue/profile spread nhỏ nhất, mid = (bid+ask)/2, ts ms giữ nguyên", () => {
  const q = parseSqBody(XAU_FIXTURE);
  assert.ok(q, "payload hợp lệ → quote");
  assert.equal(q.bid, 4430.658);
  assert.equal(q.ask, 4431.162);
  assert.ok(Math.abs(q.mid - (4430.658 + 4431.162) / 2) < 1e-9);
  assert.equal(q.ts, 1788555600090);
});

test("pickBestSqProfile: bỏ profile bid<=0 / ask<bid, chọn spread nhỏ nhất", () => {
  const best = pickBestSqProfile([
    { bid: 0, ask: 10 },
    { bid: 10, ask: 5 },
    { bid: 1.1, ask: 1.2 },
    { bid: 1.15, ask: 1.16 },
  ]);
  assert.deepEqual(best, { bid: 1.15, ask: 1.16 });
});

test("parseSqVenue: venue rỗng / toàn profile rác → null (không đoán)", () => {
  assert.equal(parseSqVenue(null), null);
  assert.equal(parseSqVenue({ spreadProfilePrices: [] }), null);
  assert.equal(parseSqVenue({ spreadProfilePrices: [{ bid: -1, ask: 5 }] }), null);
  assert.equal(parseSqBody([]), null);
  assert.equal(parseSqBody({ not: "array" }), null);
});

test("parseSqVenue: ts seconds được chuyển sang ms", () => {
  const q = parseSqVenue({ spreadProfilePrices: [{ bid: 1.16, ask: 1.17 }], ts: 1788555600 });
  assert.equal(q?.ts, 1_788_555_600_000);
});
