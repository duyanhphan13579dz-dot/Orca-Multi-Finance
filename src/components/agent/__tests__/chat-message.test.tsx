/**
 * ORCA Agent chat frame — turn renderer tests.
 *
 * Rendered with react-dom/server so the component shipped to the browser is the
 * one under test (no browser needed): block rendering, the agent meta chips and
 * the user/system variants.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import { ChatMessage, type ChatTurn } from "../chat-message";

const render = (turn: ChatTurn) => renderToStaticMarkup(<ChatMessage turn={turn} />);

test("agent answer renders headings, bullets and paragraphs as distinct markup", () => {
  const html = render({
    id: "a1",
    role: "agent",
    text: "## Độ rộng và thanh khoản\nĐộ rộng: 92 mã tăng / 301 mã giảm.\n- SSI 1.500 tỷ (+3.20%)\n1. Kịch bản cơ sở",
    ts: 1_760_000_000_000,
  });
  assert.match(html, /<h3[^>]*>Độ rộng và thanh khoản<\/h3>/);
  assert.match(html, /<p>Độ rộng: 92 mã tăng \/ 301 mã giảm\.<\/p>/);
  assert.match(html, /<span[^>]*>•<\/span>/);
  assert.match(html, /1\./);
  assert.match(html, /SSI 1\.500 tỷ \(\+3\.20%\)/);
});

test("bold and code runs get their own elements", () => {
  const html = render({ id: "a2", role: "agent", text: "Kết luận: **trung lập** với `VN30`.", ts: 1 });
  assert.match(html, /<strong[^>]*>trung lập<\/strong>/);
  assert.match(html, /<code[^>]*>VN30<\/code>/);
});

test("answer text is never emitted as raw HTML", () => {
  const html = render({ id: "a3", role: "agent", text: "<img src=x onerror=alert(1)>", ts: 1 });
  assert.ok(!html.includes("<img"), "raw tag must be escaped");
  assert.match(html, /&lt;img/);
});

test("agent meta chips expose mode, persona, confidence and symbols", () => {
  const html = render({
    id: "a4",
    role: "agent",
    text: "Trả lời.",
    ts: 1,
    meta: {
      mode: "llm",
      model: "openai/gpt-oss-120b",
      persona: "stock_analyst",
      confidence: "MEDIUM",
      dataQuality: "HIGH",
      dataFreshness: "LIVE",
      symbols: ["VN30", "SSI", "HPG", "VIC", "VCB", "MSN"],
      sectionsUsed: ["vn-market", "sectors"],
    },
  });
  assert.match(html, /openai\/gpt-oss-120b/);
  assert.match(html, /Phân tích/);
  assert.match(html, /tin cậy MEDIUM/);
  assert.match(html, /dữ liệu HIGH/);
  assert.match(html, /LIVE/);
  // first four symbols plus an overflow counter
  assert.match(html, /\+2/);
  assert.match(html, /2 nguồn/);
});

test("deterministic answers are labelled 'engine' and carry no model", () => {
  const html = render({ id: "a5", role: "agent", text: "Trả lời.", ts: 1, meta: { mode: "deterministic", model: null } });
  assert.match(html, /engine/);
  assert.ok(!html.includes("LLM"), "no LLM chip for deterministic mode");
});

test("user turns render as plain text with a timestamp and no meta row", () => {
  const html = render({ id: "u1", role: "user", text: "Thị trường đang diễn ra chuyện gì?", ts: 1_760_000_000_000 });
  assert.match(html, /Thị trường đang diễn ra chuyện gì\?/);
  assert.match(html, /<time/);
  assert.ok(!html.includes("engine"), "no meta chips on user turns");
});

test("system notices render as muted text without a copy control", () => {
  const html = render({ id: "s1", role: "agent", text: "Đã dừng câu trả lời.", ts: 1, system: true });
  assert.match(html, /Đã dừng câu trả lời\./);
  assert.ok(!html.includes("Sao chép"), "no copy button on system notices");
});
