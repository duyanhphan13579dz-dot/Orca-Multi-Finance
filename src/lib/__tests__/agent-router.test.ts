import test from "node:test";
import assert from "node:assert/strict";
import { routeAcceptanceCases, routeQuestion } from "../services/agent-router";

test("agent router routes standard acceptance cases correctly", () => {
  for (const [question, expected] of routeAcceptanceCases()) {
    const route = routeQuestion(question);
    const actual = [route.primaryDomain, ...route.secondaryDomains];
    assert.deepEqual(actual, expected, `Routing mismatch for query: "${question}"`);
  }
});

test("agent router identifies stocks beyond the top 16 VN30 tickers (BUG-04 fix)", () => {
  const cases = [
    { q: "Phân tích kỹ thuật mã DGC", expectedDomain: "stock", expectedSymbol: "DGC" },
    { q: "Giá cổ phiếu PVD hôm nay thế nào?", expectedDomain: "stock", expectedSymbol: "PVD" },
    { q: "Báo cáo tài chính KDH quý gần nhất", expectedDomain: "stock", expectedSymbol: "KDH" },
    { q: "Có nên mua REE vùng giá này?", expectedDomain: "stock", expectedSymbol: "REE" },
  ];
  for (const c of cases) {
    const route = routeQuestion(c.q);
    assert.equal(route.primaryDomain, c.expectedDomain, `Domain mismatch for "${c.q}"`);
    assert.equal(route.entities.symbols[0], c.expectedSymbol, `Symbol mismatch for "${c.q}"`);
  }
});
