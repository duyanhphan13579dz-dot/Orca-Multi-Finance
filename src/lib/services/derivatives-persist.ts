import "server-only";
import type { DerivativeContractRow } from "../types";
import { recordDerivSample } from "./derivatives-history";

/**
 * P5 — Persist derivative quotes/OI to Postgres when DATABASE_URL is set.
 * Soft-fail: never throws into quote path.
 */

export interface PersistResult {
  attempted: boolean;
  written: number;
  error: string | null;
}

export async function persistDerivativeRows(
  rows: DerivativeContractRow[],
): Promise<PersistResult> {
  if (!rows.length) return { attempted: false, written: 0, error: null };

  const now = Date.now();
  for (const r of rows) {
    if (!r.quote) continue;
    recordDerivSample({
      symbol: r.symbol,
      ts: now,
      last: r.quote.last ?? null,
      openInterest: r.quote.openInterest ?? null,
      volume: r.quote.volume ?? null,
      basis: r.basis?.basis ?? null,
      source: r.quote.source ?? null,
    });
  }

  try {
    const { databaseConfigured } = await import("@/db");
    if (typeof databaseConfigured === "function" && !databaseConfigured()) {
      return { attempted: false, written: 0, error: null };
    }
  } catch {
    /* optional */
  }

  try {
    const { pool } = await import("@/db");
    if (!pool) return { attempted: false, written: 0, error: null };

    const client = await pool.connect();
    try {
      let written = 0;
      for (const r of rows) {
        const q = r.quote;
        if (!q || (q.last == null && q.openInterest == null)) continue;
        const ts = q.updatedAt ? new Date(q.updatedAt) : new Date();
        await client.query(
          `INSERT INTO derivative_prices
            (symbol, ts, last, mark, settlement, change, change_percent, open, high, low, volume, open_interest, basis, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (symbol, ts) DO UPDATE SET
             last = EXCLUDED.last,
             open_interest = EXCLUDED.open_interest,
             volume = EXCLUDED.volume,
             basis = EXCLUDED.basis,
             source = EXCLUDED.source,
             ingested_at = now()`,
          [
            r.symbol,
            ts.toISOString(),
            q.last,
            q.mark ?? null,
            q.settlement ?? null,
            q.change ?? null,
            q.changePercent ?? null,
            q.open ?? null,
            q.high ?? null,
            q.low ?? null,
            q.volume ?? null,
            q.openInterest ?? null,
            r.basis?.basis ?? null,
            q.source ?? null,
          ],
        );
        if (q.openInterest != null) {
          await client.query(
            `INSERT INTO derivative_open_interest (symbol, ts, open_interest, oi_change, source)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (symbol, ts) DO UPDATE SET
               open_interest = EXCLUDED.open_interest,
               oi_change = EXCLUDED.oi_change,
               source = EXCLUDED.source`,
            [r.symbol, ts.toISOString(), q.openInterest, null, q.source ?? null],
          );
        }
        written += 1;
      }
      return { attempted: true, written, error: null };
    } finally {
      client.release();
    }
  } catch (e) {
    return {
      attempted: true,
      written: 0,
      error: e instanceof Error ? e.message : "persist failed",
    };
  }
}

export async function loadPricesFromDb(
  symbol: string,
  limit = 48,
): Promise<
  Array<{
    symbol: string;
    ts: number;
    last: number | null;
    openInterest: number | null;
    volume: number | null;
    basis: number | null;
    source: string | null;
  }>
> {
  try {
    const { pool } = await import("@/db");
    if (!pool) return [];
    const res = await pool.query(
      `SELECT symbol, ts, last, open_interest, volume, basis, source
       FROM derivative_prices
       WHERE symbol = $1
       ORDER BY ts DESC
       LIMIT $2`,
      [symbol.toUpperCase(), Math.min(limit, 200)],
    );
    return (res.rows as Array<Record<string, unknown>>)
      .map((row) => ({
        symbol: String(row.symbol),
        ts: new Date(String(row.ts)).getTime(),
        last: row.last != null ? Number(row.last) : null,
        openInterest: row.open_interest != null ? Number(row.open_interest) : null,
        volume: row.volume != null ? Number(row.volume) : null,
        basis: row.basis != null ? Number(row.basis) : null,
        source: row.source != null ? String(row.source) : null,
      }))
      .reverse();
  } catch {
    return [];
  }
}
