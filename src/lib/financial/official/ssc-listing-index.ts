import "server-only";
import { cached, invalidate } from "../../cache";
import { openSscNewsSearch } from "./adf-client";
import { parseSscTableHtml, rowsToFilings, type SscScrapedRow } from "./ssc-scrape";
import { getSscCalendar } from "./ssc-calendar";
import type { OfficialFiling } from "./types";

/**
 * SSC listing index — crawl trang listing mới nhất, index theo MCK.
 * Trong cửa sổ công bố: TTL ngắn; ngoài cửa sổ: TTL dài.
 *
 * Đây là lớp "hoàn thiện" không cần headless cho các mã vừa công bố
 * (thường nằm ở trang 1–vài trang đầu).
 */

export interface SscListingIndex {
  builtAt: string;
  rowCount: number;
  tickerCount: number;
  byTicker: Record<string, SscScrapedRow[]>;
  rows: SscScrapedRow[];
  notes: string[];
}

const INDEX_KEY = "ssc:listing-index:v1";

function ttlFromCalendar(): { ttlMs: number; staleMs: number } {
  const cal = getSscCalendar();
  if (cal.shouldAggressiveFetch) {
    return { ttlMs: 30 * 60_000, staleMs: 6 * 3_600_000 }; // 30m / 6h
  }
  return { ttlMs: 6 * 3_600_000, staleMs: 48 * 3_600_000 }; // 6h / 48h
}

export async function buildSscListingIndex(opts?: {
  force?: boolean;
}): Promise<SscListingIndex> {
  const { ttlMs, staleMs } = ttlFromCalendar();
  if (opts?.force) await invalidate(INDEX_KEY);

  const res = await cached(INDEX_KEY, {
    ttlMs,
    staleMs,
    skipCache: opts?.force,
    producer: async () => {
      const notes: string[] = [];
      const session = await openSscNewsSearch();
      notes.push(`session html=${session.html.length}B · ${session.latencyMs}ms`);
      const rows = parseSscTableHtml(session.html);
      notes.push(`parsed ${rows.length} rows from latest listing page`);

      const byTicker: Record<string, SscScrapedRow[]> = {};
      for (const r of rows) {
        if (!r.ticker || r.ticker.length < 2) continue;
        const k = r.ticker.toUpperCase();
        (byTicker[k] ??= []).push(r);
      }

      const idx: SscListingIndex = {
        builtAt: new Date().toISOString(),
        rowCount: rows.length,
        tickerCount: Object.keys(byTicker).length,
        byTicker,
        rows,
        notes,
      };
      return idx;
    },
  });

  return res.value;
}

export async function lookupSscIndex(symbol: string): Promise<{
  filings: OfficialFiling[];
  rows: SscScrapedRow[];
  index: SscListingIndex;
  hit: boolean;
}> {
  const sym = symbol.toUpperCase();
  const index = await buildSscListingIndex();
  const rows = index.byTicker[sym] ?? [];
  return {
    filings: rowsToFilings(rows, sym),
    rows,
    index,
    hit: rows.length > 0,
  };
}

export async function refreshSscListingIndex(): Promise<SscListingIndex> {
  return buildSscListingIndex({ force: true });
}
