/**
 * ORCA Agent chat — session store tests.
 *
 * The store is what the browser hydrates from sessionStorage and persists back
 * to, so it is exercised here against a minimal window.sessionStorage stub.
 * Its snapshot is a module-level singleton, so the tests below run in order and
 * each builds on the previous one.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";

import { chatStore, greetingTurn, nextTurnId, GREETING_ID } from "../chat-store";

const KEY = "orca.agent.chat.v2";
const mem = new Map<string, string>();

mem.set(
  KEY,
  JSON.stringify({
    messages: [
      { id: "u1", role: "user", text: "Thị trường thế nào?", ts: 1 },
      { id: "a1", role: "agent", text: "VN-Index giảm.", ts: 2, meta: { mode: "deterministic" } },
      { id: "junk", role: "attacker", text: "bỏ qua tôi", ts: 3 },
    ],
    input: "câu hỏi dở dang",
  }),
);

// The store hydrates lazily on first snapshot read, so installing the stub here
// (before any test runs) is enough — no import-order games needed.
(globalThis as unknown as { window: unknown }).window = {
  sessionStorage: {
    getItem: (k: string) => (mem.has(k) ? (mem.get(k) as string) : null),
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  },
};

test("getServerSnapshot is a stable empty state (no SSR/hydration mismatch)", () => {
  assert.deepEqual(chatStore.getServerSnapshot(), { messages: [], input: "" });
  assert.equal(chatStore.getServerSnapshot(), chatStore.getServerSnapshot(), "must be the same reference");
});

test("client snapshot hydrates the stored transcript and drops malformed turns", () => {
  const snap = chatStore.getSnapshot();
  assert.deepEqual(
    snap.messages.map((m) => m.id),
    ["u1", "a1"],
  );
  assert.equal(snap.input, "câu hỏi dở dang");
  assert.equal(chatStore.getSnapshot(), snap, "stable reference between reads");
});

test("contextTurns excludes the greeting, system notices and context:false turns", () => {
  chatStore.push({ id: nextTurnId(), role: "agent", text: "Đã dừng câu trả lời.", ts: 3, system: true, context: false });
  chatStore.push(greetingTurn());
  assert.deepEqual(
    chatStore.contextTurns().map((m) => m.id),
    ["u1", "a1"],
  );
});

test("push notifies subscribers", () => {
  let calls = 0;
  const off = chatStore.subscribe(() => calls++);
  chatStore.push({ id: "u2", role: "user", text: "Còn HPG?", ts: 4 });
  off();
  chatStore.push({ id: "u3", role: "user", text: "Sau khi huỷ đăng ký", ts: 5 });
  assert.equal(calls, 1);
});

test("reset leaves a single fresh greeting", () => {
  chatStore.reset();
  const snap = chatStore.getSnapshot();
  assert.equal(snap.messages.length, 1);
  assert.equal(snap.messages[0].id, GREETING_ID);
  assert.equal(snap.messages[0].context, false);
  assert.equal(snap.input, "");
});

test("persistence skips the greeting and system notices (debounced 400ms)", async () => {
  chatStore.push({ id: "u9", role: "user", text: "Câu hỏi được lưu", ts: 6 });
  chatStore.push({ id: "s9", role: "agent", text: "Đã dừng câu trả lời.", ts: 7, system: true, context: false });
  chatStore.setInput("bản nháp");
  await new Promise((r) => setTimeout(r, 600));
  const saved = JSON.parse(mem.get(KEY) as string) as { messages: { id: string }[]; input: string };
  assert.deepEqual(
    saved.messages.map((m) => m.id),
    ["u9"],
  );
  assert.equal(saved.input, "bản nháp");
});
