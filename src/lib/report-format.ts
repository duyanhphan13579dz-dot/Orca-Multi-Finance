/**
 * Client-safe report text formatting.
 * Strips leftover markdown (** # ## *), normalizes list markers to "-",
 * and splits multi-line paragraphs into bullet / prose blocks for UI + PDF.
 */

export type ReportLine =
  | { kind: "bullet"; text: string }
  | { kind: "prose"; text: string };

/** Remove markdown emphasis / headings and collapse excess whitespace. */
export function stripMarkdown(raw: string): string {
  let s = String(raw ?? "");
  // headings at line start: # ## ###
  s = s.replace(/^#{1,6}\s+/gm, "");
  // bold / italic
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  s = s.replace(/(?<![\w*])\*([^*]+)\*(?![\w*])/g, "$1");
  s = s.replace(/(?<![\w_])_([^_]+)_(?![\w_])/g, "$1");
  // leftover lone markers
  s = s.replace(/\*{1,3}/g, "");
  s = s.replace(/#{2,}/g, "");
  // normalize various bullet glyphs to "- "
  s = s.replace(/^[\s]*[•●○▪▸►]\s*/gm, "- ");
  s = s.replace(/^[\s]*[-–—]\s+/gm, "- ");
  // collapse spaces (keep newlines)
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/**
 * Turn a section paragraph into one or more display lines.
 * Lines that already start with "-" / "•" become bullets;
 * multi-sentence key facts may stay as prose.
 */
export function paragraphToLines(paragraph: string): ReportLine[] {
  const cleaned = stripMarkdown(paragraph);
  if (!cleaned) return [];

  // Explicit multi-line block
  if (cleaned.includes("\n")) {
    return cleaned
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) =>
        /^[-•]/.test(l)
          ? { kind: "bullet" as const, text: l.replace(/^[-•]\s*/, "") }
          : { kind: "prose" as const, text: l },
      );
  }

  // Single line starting with bullet marker
  if (/^[-•]/.test(cleaned)) {
    return [{ kind: "bullet", text: cleaned.replace(/^[-•]\s*/, "") }];
  }

  // Composer often prefixes with "• " already stripped to "- " by stripMarkdown
  if (cleaned.startsWith("- ")) {
    return [{ kind: "bullet", text: cleaned.slice(2).trim() }];
  }

  return [{ kind: "prose", text: cleaned }];
}

export function sectionToLines(paragraphs: string[]): ReportLine[] {
  const out: ReportLine[] = [];
  for (const p of paragraphs ?? []) {
    out.push(...paragraphToLines(p));
  }
  return out;
}

export function cleanHeading(heading: string): string {
  return stripMarkdown(heading).replace(/^\d+\.\s*/, (m) => m); // keep "1. " numbering
}
