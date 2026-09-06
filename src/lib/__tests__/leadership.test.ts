import test from "node:test";
import assert from "node:assert/strict";
import { computeLeadership } from "../engines/leadership";

const row = (symbol: string, changePercent: number, quoteVolume = 1000, sector = null as string | null) => ({ symbol, changePercent, quoteVolume, sector });

test("leadership: phân loại leader/laggard theo score", () => {
  const r = computeLeadership([
    row("STRONG", 5, 8000, "Ngân hàng"),
    row("MID", 6, 100, "Thép"),
    row("WEAK", -4, 2000, "Bất động sản"),
    row("FLAT", 0.1, 900, "Công nghệ"),
  ]);
  assert.equal(r.marketChangePercent, 1.77);
  const strong = r.leaders.find((x) => x.symbol === "STRONG");
  const weak = r.laggards.find((x) => x.symbol === "WEAK");
  assert.ok(strong);
  assert.ok(weak);
  assert.ok(strong.score >= 65);
  assert.ok(weak.score <= 35);
  assert.ok(strong.relativeStrength > 0);
});

test("leadership: volume share đóng góp vào score", () => {
  const a = computeLeadership([row("A", 2, 10_000), row("B", 2, 100)]).leaders;
  assert.ok(a.length >= 1);
  const aRow = computeLeadership([row("A", 2, 10_000), row("B", 2, 100)]).leaders[0];
  assert.ok(aRow && aRow.volumeSharePct > 50);
  // cùng change nhưng thanh khoản cao hơn → score cao hơn
  const rBoth = computeLeadership([row("A", 2, 10_000), row("B", 2, 100)]);
  const sa = rBoth.leaders.find((x) => x.symbol === "A");
  const sb = rBoth.leaders.find((x) => x.symbol === "B");
  assert.ok((sa?.score ?? 0) >= (sb?.score ?? 0));
});
