import "server-only";

/**
 * P3 — Derivatives quote/OI history (process ring buffer).
 * Best-effort for ΔOI and brief context. Does not invent samples.
 */

export interface DerivHistorySample {
  symbol: string;
  ts: number;
  last: number | null;
  openInterest: number | null;
  volume: number | null;
  basis: number | null;
  source: string | null;
}

const MAX_PER_SYMBOL = 96;
const store = new Map<string, DerivHistorySample[]>();

export function recordDerivSample(sample: DerivHistorySample): void {
  const sym = sample.symbol.toUpperCase();
  if (sample.last == null && sample.openInterest == null) return;
  const arr = store.get(sym) ?? [];
  const last = arr[arr.length - 1];
  if (
    last &&
    last.last === sample.last &&
    last.openInterest === sample.openInterest &&
    Math.abs(last.ts - sample.ts) < 5_000
  ) {
    return;
  }
  arr.push({ ...sample, symbol: sym });
  while (arr.length > MAX_PER_SYMBOL) arr.shift();
  store.set(sym, arr);
}

export function getDerivHistory(symbol: string, limit = 48): DerivHistorySample[] {
  const arr = store.get(symbol.toUpperCase()) ?? [];
  return arr.slice(-Math.min(Math.max(limit, 1), MAX_PER_SYMBOL));
}

export function getPriorSample(
  symbol: string,
  minAgeMs = 60_000,
): DerivHistorySample | null {
  const arr = store.get(symbol.toUpperCase()) ?? [];
  if (arr.length < 2) return arr[0] ?? null;
  const now = Date.now();
  for (let i = arr.length - 2; i >= 0; i--) {
    if (now - arr[i].ts >= minAgeMs) return arr[i];
  }
  return arr[arr.length - 2] ?? null;
}

export function historyStats(): { symbols: number; samples: number } {
  let samples = 0;
  for (const a of store.values()) samples += a.length;
  return { symbols: store.size, samples };
}

export async function getDerivHistoryPayload(
  symbol: string,
  limit = 48,
): Promise<{ symbol: string; samples: DerivHistorySample[]; note: string }> {
  const sym = symbol.toUpperCase();
  const samples = getDerivHistory(sym, limit);
  return {
    symbol: sym,
    samples,
    note:
      samples.length === 0
        ? "Chưa có sample — poll /snapshot để ghi lịch sử process"
        : `${samples.length} sample(s) trong process lifetime (max ${MAX_PER_SYMBOL}/symbol)`,
  };
}
