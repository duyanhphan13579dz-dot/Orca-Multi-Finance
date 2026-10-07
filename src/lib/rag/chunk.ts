import "server-only";

/**
 * Simple character-window chunker for Vietnamese/English research text.
 * Overlap keeps section headers attached to following body.
 */
export function chunkText(
  text: string,
  opts?: { maxChars?: number; overlap?: number },
): string[] {
  const maxChars = opts?.maxChars ?? 900;
  const overlap = opts?.overlap ?? 120;
  const cleaned = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxChars) return [cleaned];

  const parts: string[] = [];
  let i = 0;
  while (i < cleaned.length) {
    let end = Math.min(i + maxChars, cleaned.length);
    if (end < cleaned.length) {
      const slice = cleaned.slice(i, end);
      const breakAt = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("。"), slice.lastIndexOf(". "));
      if (breakAt > maxChars * 0.4) end = i + breakAt + 1;
    }
    const piece = cleaned.slice(i, end).trim();
    if (piece) parts.push(piece);
    if (end >= cleaned.length) break;
    i = Math.max(end - overlap, i + 1);
  }
  return parts;
}

/** Token-ish keywords for lexical scoring (VN + EN finance) */
export function tokenizeQuery(q: string): string[] {
  const raw = q
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ\s]/gi, " ");
  const stop = new Set([
    "va", "cua", "cho", "voi", "cac", "mot", "nhung", "the", "nao", "thi", "la", "trong", "khi",
    "the", "a", "an", "of", "to", "for", "on", "in", "is", "are",
  ]);
  return [...new Set(raw.split(/\s+/).filter((t) => t.length >= 2 && !stop.has(t)))].slice(0, 24);
}

export function lexicalScore(text: string, tokens: string[]): number {
  if (!tokens.length) return 0;
  const hay = text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  let hits = 0;
  for (const t of tokens) {
    if (hay.includes(t)) hits += 1;
  }
  return hits / tokens.length;
}
