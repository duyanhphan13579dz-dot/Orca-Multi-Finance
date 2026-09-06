import test from "node:test";
import assert from "node:assert/strict";
import { vnDateKey, roundToMinute, barToArchiveRow, quoteToArchiveRow, archiveRowToBar } from "../services/archive";
import type { OhlcvBar, Quote } from "../types";

test("archive: vnDateKey converts epoch → YYYY-MM-DD giờ VN (+07)", () => {
  // 2026-09-06 20:00 UTC = 2026-09-07 03:00 +07
  const ms = Date.parse("2026-09-06T20:00:00Z");
  assert.equal(vnDateKey(ms), "2026-09-07");
  // 2026-09-06 02:00 UTC = 2026-09-06 09:00 +07
  assert.equal(vnDateKey(Date.parse("2026-09-06T02:00:00Z")), "2026-09-06");
});

test("archive: roundToMinute dedupe đúng mốc phút", () => {
  const base = Date.parse("2026-09-07T02:00:00Z");
  assert.equal(roundToMinute(base), base);
  assert.equal(roundToMinute(base + 59_999), base);
  assert.equal(roundToMinute(base + 60_000), base + 60_000);
});

test("archive: barToArchiveRow maps OHLCV → row theo ngày VN", () => {
  const bar: OhlcvBar = { time: Date.parse("2026-09-06T02:00:00Z"), open: 10, high: 12, low: 9, close: 11, volume: 500 };
  const row = barToArchiveRow("vnm", bar, "scheduler:daily");
  assert.equal(row.symbol, "VNM");
  assert.equal(row.date, "2026-09-06");
  assert.equal(row.close, "11");
  assert.equal(row.volume, "500");
  assert.equal(row.source, "scheduler:daily");
});

test("archive: quoteToArchiveRow — ts rounded + close = price + null-safe", () => {
  const q: Quote = {
    symbol: "HPG",
    assetClass: "stock",
    price: 30_500,
    change: 200,
    changePercent: 0.66,
    high: 30_800,
    volume: 1_000_000,
    updatedAt: new Date(Date.parse("2026-09-07T02:00:30Z")).toISOString(),
  };
  const row = quoteToArchiveRow("HPG", q, "vn-engine:vndirect");
  assert.equal(row.ts.toISOString(), new Date(Date.parse("2026-09-07T02:00:00Z")).toISOString());
  assert.equal(row.close, "30500");
  assert.equal(row.change, "200");
  assert.equal(row.value, null); // quoteVolume không có → null
  const q2 = { ...q, updatedAt: null, price: 1, high: undefined as unknown as number | null };
  const row2 = quoteToArchiveRow("HPG", q2, "x");
  assert.equal(row2.high, null);
});

test("archive: archiveRowToBar — reconstructs bar từ row (00:00 +07) + rejects invalid", () => {
  const bar = archiveRowToBar({ date: "2026-09-06", open: "10", high: "12", low: "9", close: "11", volume: "500" });
  assert.ok(bar);
  assert.equal(bar.close, 11);
  assert.equal(bar.time, Date.parse("2026-09-06T00:00:00+07:00"));
  assert.equal(archiveRowToBar({ date: "2026-09-06", open: null, high: "12", low: "9", close: "11", volume: null }), null);
});
