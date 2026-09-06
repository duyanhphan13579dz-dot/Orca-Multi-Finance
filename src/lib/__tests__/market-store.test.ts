import test from "node:test";
import assert from "node:assert/strict";
import { marketStore, type StoredQuote } from "../realtime/market-store";
import { emitEvent, resetEventModel } from "../realtime/event-envelope";

const BASE = { assetType: "crypto" as const, symbol: "TESTSTORE", source: "test", ts: Date.now() };

function fresh(): typeof marketStore {
  marketStore.reset();
  return marketStore;
}

test("market store: setQuote validates + stores + emits quote event", () => {
  const store = fresh();
  const got: StoredQuote[] = [];
  const off = store.subscribe(["TESTSTORE"], (q) => got.push(q));
  try {
    assert.equal(store.setQuote({ ...BASE, price: 100, changePercent: 1.5, volume: 10 }), true);
    const q = store.get("teststore");
    assert.ok(q);
    assert.equal(q.price, 100);
    assert.equal(q.quality, "VALID");
    assert.ok(q.ingestedAt > 0);
    assert.equal(got.length, 1);
    assert.equal(store.stats().writes, 1);
    assert.equal(store.stats().symbols, 1);
  } finally {
    off();
  }
});

test("market store: rejects invalid quote (INVALID) — no write, no event", () => {
  const store = fresh();
  let events = 0;
  const off = store.subscribe(["BAD"], () => events++);
  try {
    assert.equal(store.setQuote({ ...BASE, symbol: "BAD", price: -5 }), false);
    assert.equal(store.get("BAD"), null);
    assert.equal(events, 0);
    assert.equal(store.stats().rejected, 1);
  } finally {
    off();
  }
});

test("market store: auto-ingests typed tick events", () => {
  const store = fresh();
  resetEventModel();
  emitEvent("tick:INGEST", "tick", { symbol: "INGEST", price: 55, cumVolume: 100, cumQuoteVolume: 1000, ts: Date.now() }, {
    assetType: "crypto",
    symbol: "INGEST",
  });
  const q = store.get("INGEST");
  assert.ok(q);
  assert.equal(q.price, 55);
  assert.equal(q.source, "event-bus:tick");
});

test("market store: snapshot filter + getMany + dedup subscribe", () => {
  const store = fresh();
  store.setQuote({ ...BASE, symbol: "S1", price: 1 });
  store.setQuote({ ...BASE, symbol: "S2", price: 2 });
  store.setQuote({ ...BASE, symbol: "S3", assetType: "stock", price: 3 });
  assert.equal(store.snapshot().length, 3);
  assert.equal(store.snapshot("crypto").length, 2);
  assert.equal(store.getMany(["S1", "S3"])[0].symbol, "S1");
  let calls = 0;
  const off = store.subscribe(["S1", "S1", "s1"], () => calls++);
  try {
    store.setQuote({ ...BASE, symbol: "S1", price: 1.5 });
    assert.equal(calls, 1);
  } finally {
    off();
  }
});
