import test from "node:test";
import assert from "node:assert/strict";
import { emitEvent, onEvent, onAnyEvent, replayEvents, payloadOf, resetEventModel } from "../realtime/event-envelope";

test("event envelope: emit → typed id/channel/type/ts/seq/payload", () => {
  resetEventModel();
  const got: unknown[] = [];
  const off = onEvent("tick:BTCTEST", (e) => got.push(e));
  try {
    const e = emitEvent("tick:BTCTEST", "tick", { price: 100 }, { assetType: "crypto", symbol: "BTCTEST", ts: 1234 });
    assert.ok(e.id.startsWith("tick:BTCTEST:"));
    assert.equal(e.channel, "tick:BTCTEST");
    assert.equal(e.type, "tick");
    assert.equal(e.assetType, "crypto");
    assert.equal(e.symbol, "BTCTEST");
    assert.equal(e.ts, 1234);
    assert.ok(e.seq >= 1);
    assert.deepEqual(e.payload, { price: 100 });
    assert.equal(got.length, 1);
  } finally {
    off();
  }
});

test("event envelope: seq increments per channel", () => {
  resetEventModel();
  const a = emitEvent("tick:A", "tick", {});
  const b = emitEvent("tick:A", "tick", {});
  const c = emitEvent("tick:B", "tick", {});
  assert.equal(Number(a.id.split(":").pop()), 1);
  assert.equal(Number(b.id.split(":").pop()), 2);
  assert.equal(Number(c.id.split(":").pop()), 1);
  assert.equal(b.seq, 2);
});

test("event envelope: onAnyEvent sees every channel", () => {
  resetEventModel();
  const seen: string[] = [];
  const off = onAnyEvent((e) => seen.push(e.channel));
  try {
    emitEvent("tick:X", "tick", {});
    emitEvent("market.quote:Y", "quote", {});
    assert.deepEqual(seen, ["tick:X", "market.quote:Y"]);
  } finally {
    off();
  }
});

test("event envelope: replayEvents returns recent per channel (bounded)", () => {
  resetEventModel();
  for (let i = 0; i < 10; i++) emitEvent("tick:Z", "tick", { i });
  const replay = replayEvents("tick:Z", 3);
  assert.equal(replay.length, 3);
  assert.deepEqual(replay.map((e) => (e.payload as { i: number }).i), [7, 8, 9]);
});

test("event envelope: payloadOf unwraps envelope and passes raw through", () => {
  const e = emitEvent("tick:RAW", "tick", { price: 42 });
  assert.deepEqual(payloadOf<{ price: number }>(e), { price: 42 });
  assert.deepEqual(payloadOf<{ price: number }>({ price: 7 }), { price: 7 });
});

test("event envelope: handler failure is isolated", () => {
  resetEventModel();
  const off = onEvent("tick:FAIL", () => {
    throw new Error("boom");
  });
  try {
    let ok = false;
    const off2 = onEvent("tick:FAIL", () => {
      ok = true;
    });
    try {
      emitEvent("tick:FAIL", "tick", {});
      assert.equal(ok, true);
    } finally {
      off2();
    }
  } finally {
    off();
  }
});
