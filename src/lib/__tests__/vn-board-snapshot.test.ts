import assert from "node:assert/strict";
import test from "node:test";
import { getVnBoardSnapshot, VN_BOARD_SNAPSHOT_SESSION } from "../providers/vn-board-snapshot";

test("snapshot board: 100 mã duy nhất, mọi giá trị hữu hạn và đúng băng giá", () => {
  const s = getVnBoardSnapshot();
  assert.equal(s.quotes.length, 100);
  assert.equal(new Set(s.quotes.map((q) => q.symbol)).size, 100);
  assert.equal(s.sessionDate, VN_BOARD_SNAPSHOT_SESSION);

  for (const q of s.quotes) {
    for (const v of [q.price, q.open, q.high, q.low, q.volume]) {
      assert.ok(v != null && Number.isFinite(v), `${q.symbol} finite`);
    }
    assert.ok(q.price > 0, `${q.symbol} price > 0`);
    assert.ok(q.high! >= q.low!, `${q.symbol} high >= low`);
    // băng giá HOSE/HNX/UPCOM: floor <= ref <= ceiling và close nằm trong biên ±7%
    assert.ok(q.ceilingPrice! >= q.referencePrice!, `${q.symbol} ceil >= ref`);
    assert.ok(q.referencePrice! >= q.floorPrice!, `${q.symbol} ref >= floor`);
    assert.ok(q.price <= q.ceilingPrice! * 1.001 && q.price >= q.floorPrice! * 0.999, `${q.symbol} close trong băng`);
    assert.ok(q.updatedAt != null && !Number.isNaN(Date.parse(q.updatedAt!)), `${q.symbol} updatedAt`);
  }
});

test("snapshot indices: đủ 6 chỉ số, giá trị hữu hạn", () => {
  const s = getVnBoardSnapshot();
  const codes = s.indices.map((i) => i.code);
  for (const c of ["VNINDEX", "VN30", "HNX", "UPCOM", "VN100", "HNX30"]) {
    assert.ok(codes.includes(c), c);
  }
  for (const i of s.indices) {
    assert.ok(Number.isFinite(i.value) && i.value > 0, i.code);
    assert.ok(Number.isFinite(i.change) && Number.isFinite(i.changePercent), i.code);
  }
  const vn = s.indices.find((i) => i.code === "VNINDEX")!;
  assert.ok(Math.abs(vn.value - 1829.23) < 1e-6, "VNINDEX đóng cửa 1829.23");
});
