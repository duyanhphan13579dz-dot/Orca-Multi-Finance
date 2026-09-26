/**
 * ORCA Agent chat — markdown-lite parser (pure, framework-free).
 *
 * Agent answers arrive as plain text: the deterministic engine emits
 * `heading\n` + one fact per line, while the LLM persona emits real Markdown
 * (headings, bullets, wrapped paragraphs, **bold**, `code`). The chat frame
 * renders both from the same block model, so this lives outside React and is
 * unit-tested in isolation (src/lib/ai/__tests__/chat-format.test.ts).
 *
 * Deliberately no HTML parsing and no dangerouslySetInnerHTML: the parser can
 * only ever produce text nodes, so answer text can never inject markup.
 */

export interface ChatInline {
  text: string;
  bold?: boolean;
  code?: boolean;
}

export type ChatBlock =
  | { type: "heading"; level: 2 | 3; inline: ChatInline[] }
  | { type: "bullet"; marker: string; inline: ChatInline[] }
  | { type: "quote"; inline: ChatInline[] }
  | { type: "para"; inline: ChatInline[] }
  | { type: "gap" };

const HEAD_RE = /^(#{1,6})\s+/;
const BULLET_RE = /^[-*•·+]\s+/;
const ORDERED_RE = /^(\d{1,2})[.)]\s+/;
const QUOTE_RE = /^>\s?/;
/** A line starting lowercase is treated as a wrapped continuation of the paragraph above. */
const CONTINUATION_RE = /^[\p{Ll}]/u;
const INLINE_RE = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`)/g;

/** Split `**bold**`, `__bold__` and `` `code` `` runs out of a single line. */
export function parseInline(text: string): ChatInline[] {
  const out: ChatInline[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    const token = m[0];
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    if (token.startsWith("`")) out.push({ text: token.slice(1, -1), code: true });
    else out.push({ text: token.slice(2, -2), bold: true });
    last = m.index + token.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.filter((s) => s.text.length > 0);
}

/** Plain text of a block, for the copy-to-clipboard action. */
export function blockText(block: ChatBlock): string {
  if (block.type === "gap") return "";
  const body = block.inline.map((s) => s.text).join("");
  if (block.type === "heading") return `${"#".repeat(block.level)} ${body}`;
  if (block.type === "bullet") return `${block.marker} ${body}`;
  if (block.type === "quote") return `> ${body}`;
  return body;
}

/**
 * Turn raw answer text into blocks.
 * - `##`/`###` → heading (levels collapse to 2|3 for a consistent chat scale)
 * - `-`, `*`, `•`, `1.` → bullet, marker preserved
 * - `>` → quote
 * - blank line → single gap (runs collapse, never leading)
 * - otherwise a paragraph; consecutive lines that start lowercase are joined,
 *   so wrapped LLM prose reads as prose while the deterministic engine's
 *   "Label: value" lines (all capitalised) stay one line per block.
 */
export function parseChatBlocks(text: string): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  let para: string[] = [];

  const flush = () => {
    if (para.length === 0) return;
    blocks.push({ type: "para", inline: parseInline(para.join(" ")) });
    para = [];
  };

  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  for (const raw of lines) {
    const line = raw.trim();

    if (!line) {
      flush();
      if (blocks.length > 0 && blocks[blocks.length - 1].type !== "gap") blocks.push({ type: "gap" });
      continue;
    }

    const head = HEAD_RE.exec(line);
    if (head) {
      flush();
      const body = line.slice(head[0].length).trim();
      if (body) blocks.push({ type: "heading", level: head[1].length >= 3 ? 3 : 2, inline: parseInline(body) });
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      flush();
      blocks.push({ type: "bullet", marker: "•", inline: parseInline(line.slice(bullet[0].length)) });
      continue;
    }

    const ordered = ORDERED_RE.exec(line);
    if (ordered) {
      flush();
      blocks.push({ type: "bullet", marker: `${ordered[1]}.`, inline: parseInline(line.slice(ordered[0].length)) });
      continue;
    }

    const quote = QUOTE_RE.exec(line);
    if (quote) {
      flush();
      blocks.push({ type: "quote", inline: parseInline(line.slice(quote[0].length)) });
      continue;
    }

    if (para.length > 0 && CONTINUATION_RE.test(line)) para.push(line);
    else {
      flush();
      para.push(line);
    }
  }
  flush();
  return blocks;
}
