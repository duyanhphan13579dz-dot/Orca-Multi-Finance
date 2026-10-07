/**
 * ORCA Agent chat — markdown-lite parser tests.
 *
 * Run: npm test   (same tsx + server-only stub harness as the chart engine suite)
 */
import test from "node:test";
import assert from "node:assert/strict";

import { blockText, parseChatBlocks, parseInline } from "../chat-format";

const kinds = (text: string) => parseChatBlocks(text).map((b) => b.type);

/* ------------------------- deterministic engine output ------------------------- */

test("deterministic narrative: every 'Label: value' line stays its own block", () => {
  const narrative = [
    "VN-Index 1.245,30 điểm (-0,8%).",
    "Độ rộng: 92 mã tăng / 301 mã giảm / 60 đứng giá (tỷ lệ tăng/giảm 0.23).",
    "Thanh khoản: giá trị giao dịch ≈ 20.500 tỷ đồng.",
    "Trần/sàn: 12 mã trần / 4 mã sàn.",
  ].join("\n");
  const blocks = parseChatBlocks(narrative);
  assert.deepEqual(blocks.map((b) => b.type), ["para", "para", "para", "para"]);
  // capitalised line starts must not be merged into one run-on paragraph
  assert.equal(blocks.length, 4);
  assert.match(blockText(blocks[2]), /20\.500 tỷ/);
});

/* --------------------------------- headings ---------------------------------- */

test("headings: # and ## collapse to level 2, ### and deeper to level 3", () => {
  const blocks = parseChatBlocks("# A\n## B\n### C\n#### D");
  assert.deepEqual(
    blocks.map((b) => (b.type === "heading" ? b.level : null)),
    [2, 2, 3, 3],
  );
});

test("heading body is parsed for inline emphasis", () => {
  const [h] = parseChatBlocks("## Độ rộng và **thanh khoản**");
  assert.equal(h.type, "heading");
  if (h.type !== "heading") return;
  assert.deepEqual(h.inline, [
    { text: "Độ rộng và " },
    { text: "thanh khoản", bold: true },
  ]);
});

/* ---------------------------------- bullets ---------------------------------- */

test("bullets: -, *, •, + all become bullets with a • marker", () => {
  const blocks = parseChatBlocks("- một\n* hai\n• ba\n+ bốn");
  assert.deepEqual(blocks.map((b) => b.type), ["bullet", "bullet", "bullet", "bullet"]);
  assert.deepEqual(blocks.map((b) => (b.type === "bullet" ? b.marker : "")), ["•", "•", "•", "•"]);
});

test("ordered bullets keep their number as the marker", () => {
  const blocks = parseChatBlocks("1. Kịch bản cơ sở\n2) Kịch bản xấu\n10. dài");
  assert.deepEqual(blocks.map((b) => (b.type === "bullet" ? b.marker : "")), ["1.", "2.", "10."]);
});

test("quote blocks", () => {
  const blocks = parseChatBlocks("> Không phải khuyến nghị đầu tư");
  assert.deepEqual(kinds("> Không phải khuyến nghị đầu tư"), ["quote"]);
  assert.equal(blockText(blocks[0]), "> Không phải khuyến nghị đầu tư");
});

/* ---------------------------- wrapped prose merging --------------------------- */

test("wrapped LLM prose is joined into one paragraph", () => {
  const blocks = parseChatBlocks("Thị trường phân hoá rõ trong phiên sáng\nkhi thanh khoản co lại đáng kể.");
  assert.deepEqual(kinds("Thị trường phân hoá rõ\nkhi thanh khoản co lại."), ["para"]);
  assert.equal(blockText(blocks[0]), "Thị trường phân hoá rõ trong phiên sáng khi thanh khoản co lại đáng kể.");
});

test("a capitalised line still starts a new paragraph", () => {
  assert.deepEqual(kinds("Nhận định chung: trung lập.\nRủi ro: thanh khoản mỏng."), ["para", "para"]);
});

/* ----------------------------------- gaps ------------------------------------ */

test("blank lines collapse to a single gap and never lead", () => {
  assert.deepEqual(kinds("\n\nĐầu\n\n\n\nCuối"), ["para", "gap", "para"]);
});

test("blocks separated by a blank line stay separate", () => {
  assert.deepEqual(kinds("## Tiêu đề\n\nNội dung"), ["heading", "gap", "para"]);
});

/* --------------------------------- inline ------------------------------------ */

test("parseInline: bold, __bold__ and code runs", () => {
  assert.deepEqual(parseInline("A **B** C `D` E __F__"), [
    { text: "A " },
    { text: "B", bold: true },
    { text: " C " },
    { text: "D", code: true },
    { text: " E " },
    { text: "F", bold: true },
  ]);
});

test("parseInline: unclosed markers are left as literal text", () => {
  assert.deepEqual(parseInline("giá **chưa đóng"), [{ text: "giá **chưa đóng" }]);
});

/* --------------------------------- robustness -------------------------------- */

test("empty / whitespace input yields no blocks", () => {
  assert.deepEqual(parseChatBlocks(""), []);
  assert.deepEqual(parseChatBlocks("   \n \n"), []);
});

test("CRLF answers are normalised", () => {
  assert.deepEqual(kinds("Một\r\nHai"), ["para", "para"]);
});
