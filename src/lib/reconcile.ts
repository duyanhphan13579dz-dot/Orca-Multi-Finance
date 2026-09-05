import "server-only";
import type { Quote } from "./types";
import { validateQuote, type QualityResult } from "./quality";

/**
 * DATA RECONCILIATION ENGINE — VNStock (primary) vs VNDirect (validation).
 *
 * Selection rules (in order):
 *  1. Records that pass quality validation beat flagged records.
 *  2. Fresher source timestamp wins (market-session aware).
 *  3. Provider priority breaks near-ties (timestamps within 90s).
 *
 * We NEVER average providers. Discrepancies beyond tolerance are recorded.
 */

export interface ProviderQuoteSet {
  provider: string;
  priority: number; // lower = higher priority
  quotes: Quote[];
  sourceTimestampMs: number | null;
  quality: Map<string, QualityResult>;
}

export interface ReconciledResult {
  quotes: Quote[];
  winnerProviders: Map<string, string>;
  discrepancies: { symbol: string; values: { provider: string; price: number | null }[]; deviationPct: number }[];
  notes: string[];
}

export function buildQuoteSet(provider: string, priority: number, quotes: Quote[]): ProviderQuoteSet {
  const quality = new Map<string, QualityResult>();
  let newest: number | null = null;
  for (const q of quotes) {
    const ts = q.updatedAt ? Date.parse(q.updatedAt) : null;
    quality.set(q.symbol, validateQuote(q, { assetClass: q.assetClass, sourceTimestampMs: ts, staleMs: 24 * 3_600_000 }));
    if (ts != null && (newest == null || ts > newest)) newest = ts;
  }
  return { provider, priority, quotes, sourceTimestampMs: newest, quality };
}

export function reconcileQuotes(sets: ProviderQuoteSet[], tolerancePct = 0.8): ReconciledResult {
  const bySymbol = new Map<string, (Quote & { _set: ProviderQuoteSet })[]>();
  for (const s of sets) {
    for (const q of s.quotes) {
      const arr = bySymbol.get(q.symbol) ?? [];
      arr.push({ ...q, _set: s });
      bySymbol.set(q.symbol, arr);
    }
  }
  const out: Quote[] = [];
  const winners = new Map<string, string>();
  const discrepancies: ReconciledResult["discrepancies"] = [];
  const notes: string[] = [];

  for (const [symbol, candidates] of bySymbol) {
    const ranked = [...candidates].sort((a, b) => {
      const qa = a._set.quality.get(symbol);
      const qb = b._set.quality.get(symbol);
      const scoreA = qa?.status === "VALID" ? 2 : qa?.status === "SUSPECT" ? 1 : 0;
      const scoreB = qb?.status === "VALID" ? 2 : qb?.status === "SUSPECT" ? 1 : 0;
      if (scoreA !== scoreB) return scoreB - scoreA;
      const ta = a.updatedAt ? Date.parse(a.updatedAt) : 0;
      const tb = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      const diff = Math.abs(ta - tb);
      if (diff > 90_000) return tb - ta; // fresher wins
      return a._set.priority - b._set.priority; // near-tie → priority
    });
    const winner = ranked[0];
    winners.set(symbol, winner._set.provider);
    const { _set, ...quote } = winner;
    out.push(quote);

    // discrepancy detection across providers that actually have the symbol
    const priced = candidates.filter((c) => Number.isFinite(c.price) && c.price > 0);
    if (priced.length >= 2) {
      const prices = priced.map((c) => c.price);
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      const devPct = ((max - min) / winner.price) * 100;
      if (devPct > tolerancePct) {
        discrepancies.push({
          symbol,
          values: priced.map((c) => ({ provider: c._set.provider, price: c.price })),
          deviationPct: Number(devPct.toFixed(3)),
        });
      }
    }
  }

  if (discrepancies.length) {
    notes.push(
      `Phát hiện ${discrepancies.length} chênh lệch provider vượt tolerance: ${discrepancies
        .slice(0, 5)
        .map((d) => `${d.symbol} (${d.deviationPct}%)`)
        .join(", ")} — hệ thống chọn theo priority rules, không lấy trung bình.`,
    );
  }
  const providers = new Set(winners.values());
  for (const p of providers) {
    const count = [...winners.values()].filter((x) => x === p).length;
    notes.push(`${p}: chọn ${count} mã`);
  }
  return { quotes: out, winnerProviders: winners, discrepancies, notes };
}

export async function logDiscrepancies(r: ReconciledResult) {
  if (!r.discrepancies.length) return;
  try {
    const { db } = await import("@/db");
    const { providerLogs } = await import("@/db/schema");
    for (const d of r.discrepancies.slice(0, 20)) {
      await db.insert(providerLogs).values({
        provider: "reconciliation",
        event: "provider_discrepancy",
        message: `${d.symbol}: ${d.values.map((v) => `${v.provider}=${v.price}`).join(" vs ")} (dev ${d.deviationPct}%)`,
        meta: d,
      });
    }
  } catch {
    /* best-effort */
  }
}
