import "server-only";

/**
 * LLM OUTPUT VALIDATION — anti-hallucination gate.
 * Every numeric claim in the LLM answer must trace back to a number in the
 * structured context (with tolerance). Unsupported price-like claims trigger
 * REPAIR (one strict regeneration) or deterministic fallback.
 */

export interface NumericClaim {
  raw: string;
  value: number;
  isPercent: boolean;
}

function parseLocalNumber(raw: string): number | null {
  let s = raw.replace(/\s/g, "");
  const isDotGrouped = /^\d{1,3}(\.\d{3})+$/.test(s); // "500.000" / "1.250.000" (VN thousands)
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // the separator appearing last is the decimal separator
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma) {
    // "79,591" (thousands) vs "45,3" (decimal)
    s = /,\d{1,2}$/.test(s) && !/,\d{3}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if (isDotGrouped) {
    // "500.000" → 500000 (vi-VN dùng chấm làm dấu phân cách hàng nghìn)
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function extractNumericClaims(text: string): NumericClaim[] {
  const out: NumericClaim[] = [];
  const re = /(-?\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?)\s*(%)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const value = parseLocalNumber(m[1]);
    if (value == null) continue;
    out.push({ raw: m[0], value, isPercent: Boolean(m[2]) });
  }
  return out;
}

/** recursively collect reference numbers from the structured context */
export function collectFactNumbers(obj: unknown, acc = new Set<number>()): Set<number> {
  if (obj == null) return acc;
  if (typeof obj === "number" && Number.isFinite(obj)) {
    acc.add(Number(obj.toPrecision(8)));
  } else if (Array.isArray(obj)) {
    for (const v of obj) collectFactNumbers(v, acc);
  } else if (typeof obj === "object") {
    for (const v of Object.values(obj as Record<string, unknown>)) collectFactNumbers(v, acc);
  }
  return acc;
}

export function validateOutput(
  text: string,
  facts: Set<number>,
  tolerance = 0.01,
): { ok: boolean; unsupported: NumericClaim[]; checked: number; supported: number } {
  const claims = extractNumericClaims(text);
  const unsupported: NumericClaim[] = [];
  let checked = 0;
  let supported = 0;
  for (const c of claims) {
    const abs = Math.abs(c.value);
    // ignore tiny ordinals, years/dates, percentages of small counts
    if (abs < 10 || (abs >= 1900 && abs <= 2100)) continue;
    checked++;
    let ok = false;
    for (const f of facts) {
      if (f === 0) continue;
      const rel = Math.abs(c.value - f) / Math.max(Math.abs(f), 1e-9);
      if (rel <= tolerance) {
        ok = true;
        break;
      }
      // large numbers formatted compactly (T/B/M/tr) get looser tolerance
      if (rel <= 0.05 && abs >= 1e6) {
        ok = true;
        break;
      }
    }
    if (ok) supported++;
    else unsupported.push(c);
  }
  return { ok: unsupported.length === 0, unsupported, checked, supported };
}
