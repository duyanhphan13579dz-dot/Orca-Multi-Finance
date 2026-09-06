/**
 * ASYNC HISTORICAL ARCHIVE (Phase 2)
 *
 * Lưu trữ best-effort, async: quote snapshot (mỗi phút, dedupe bằng PK
 * symbol+ts) và nến ngày OHLCV (PK symbol+date) vào `stock_quotes` /
 * `stock_ohlcv`. Khi provider offline, archive trở thành fallback đọc lịch sử.
 *
 * Quy tắc:
 *   - Không bao giờ chặn request path (mọi lỗi DB nuốt + log).
 *   - Idempotent theo minute/date → cron/retry an toàn, multi-instance an toàn.
 *   - Ghi thêm, không sửa bản ghi cũ của ngày khác (upsert trên cùng key).
 */

import "server-only";
import type { OhlcvBar, Quote } from "../types";

const ARCHIVE_KEY_PREFIX = "archive:vndaily";
const ARCHIVE_DAILY_LIMIT = 25;

/* ------------------------------ pure helpers ------------------------------ */

/** YYYY-MM-DD theo giờ VN (+07) của một epoch ms. */
export function vnDateKey(ms: number): string {
  const d = new Date(ms + 7 * 3_600_000);
  return d.toISOString().slice(0, 10);
}

/** Round epoch → đầu phút (dedupe snapshot theo phút). */
export function roundToMinute(ms: number): number {
  return Math.floor(ms / 60_000) * 60_000;
}

/** OhlcvBar → row cho stock_ohlcv (date key theo giờ VN). */
export function barToArchiveRow(symbol: string, bar: OhlcvBar, source: string): {
  symbol: string;
  date: string;
  open: string | null;
  high: string | null;
  low: string | null;
  close: string | null;
  volume: string | null;
  source: string;
} {
  const num = (v: number | undefined | null): string | null => (v != null && Number.isFinite(v) ? String(v) : null);
  return {
    symbol: symbol.toUpperCase(),
    date: vnDateKey(bar.time),
    open: num(bar.open),
    high: num(bar.high),
    low: num(bar.low),
    close: num(bar.close),
    volume: num(bar.volume),
    source,
  };
}

/** Quote → row cho stock_quotes (ts = đầu phút). */
export function quoteToArchiveRow(symbol: string, q: Pick<Quote, "price" | "open" | "high" | "low" | "volume" | "quoteVolume" | "change" | "changePercent" | "updatedAt">, source: string): {
  symbol: string;
  ts: Date;
  open: string | null;
  high: string | null;
  low: string | null;
  close: string | null;
  volume: string | null;
  value: string | null;
  change: string | null;
  changePercent: string | null;
  source: string;
} {
  const num = (v: number | null | undefined): string | null => (v != null && Number.isFinite(v) ? String(v) : null);
  const ms = q.updatedAt ? Date.parse(q.updatedAt) || Date.now() : Date.now();
  return {
    symbol: symbol.toUpperCase(),
    ts: new Date(roundToMinute(ms)),
    open: num(q.open),
    high: num(q.high),
    low: num(q.low),
    close: num(q.price),
    volume: num(q.volume),
    value: num(q.quoteVolume),
    change: num(q.change),
    changePercent: num(q.changePercent),
    source,
  };
}

/** OhlcvRow (archive) → OhlcvBar với open time 00:00 +07 (ổn định cho chart). */
export function archiveRowToBar(r: { date: string; open: string | null; high: string | null; low: string | null; close: string | null; volume: string | null }): OhlcvBar | null {
  const open = r.open != null ? Number(r.open) : null;
  const high = r.high != null ? Number(r.high) : null;
  const low = r.low != null ? Number(r.low) : null;
  const close = r.close != null ? Number(r.close) : null;
  if (open == null || high == null || low == null || close == null || !Number.isFinite(close)) return null;
  // 00:00 giờ VN = 17:00 UTC ngày hôm trước
  const time = Date.parse(`${r.date}T00:00:00+07:00`);
  if (!Number.isFinite(time)) return null;
  return {
    time,
    open,
    high,
    low,
    close,
    volume: r.volume != null && Number.isFinite(Number(r.volume)) ? Number(r.volume) : 0,
  };
}

/* ------------------------------- DB access -------------------------------- */

async function dbAccess() {
  const [{ db }, { stockQuotes }, { stockOhlcv }, drizzle] = await Promise.all([
    import("@/db"),
    import("@/db/schema"),
    import("@/db/schema"),
    import("drizzle-orm"),
  ]);
  return { db, stockQuotes, stockOhlcv, drizzle };
}

/** Archive một snapshot quote (dedupe theo phút). Best-effort. */
export async function archiveQuoteSnapshot(symbol: string, q: Pick<Quote, "price" | "open" | "high" | "low" | "volume" | "quoteVolume" | "change" | "changePercent" | "updatedAt">, source: string): Promise<boolean> {
  try {
    const { db, stockQuotes, drizzle } = await dbAccess();
    const row = quoteToArchiveRow(symbol, q, source);
    await db
      .insert(stockQuotes)
      .values(row)
      .onConflictDoUpdate({
        target: [stockQuotes.symbol, stockQuotes.ts],
        set: {
          open: drizzle.sql`excluded.open`,
          high: drizzle.sql`excluded.high`,
          low: drizzle.sql`excluded.low`,
          close: drizzle.sql`excluded.close`,
          volume: drizzle.sql`excluded.volume`,
          value: drizzle.sql`excluded.value`,
          change: drizzle.sql`excluded.change`,
          changePercent: drizzle.sql`excluded.change_percent`,
          source: drizzle.sql`excluded.source`,
          ingestedAt: new Date(),
        },
      });
    return true;
  } catch {
    return false;
  }
}

/** Archive nến ngày (upsert idempotent theo symbol+date). Best-effort. */
export async function archiveDailyBars(symbol: string, bars: OhlcvBar[], source: string): Promise<number> {
  if (!bars.length) return 0;
  try {
    const { db, stockOhlcv, drizzle } = await dbAccess();
    const rows = bars.map((b) => barToArchiveRow(symbol, b, source));
    let written = 0;
    for (const row of rows) {
      await db
        .insert(stockOhlcv)
        .values(row)
        .onConflictDoUpdate({
          target: [stockOhlcv.symbol, stockOhlcv.date],
          set: {
            open: drizzle.sql`excluded.open`,
            high: drizzle.sql`excluded.high`,
            low: drizzle.sql`excluded.low`,
            close: drizzle.sql`excluded.close`,
            volume: drizzle.sql`excluded.volume`,
            source: drizzle.sql`excluded.source`,
            ingestedAt: new Date(),
          },
        });
      written += 1;
    }
    return written;
  } catch {
    return 0;
  }
}

/** Đọc nến ngày đã archive (fallback khi provider offline). Sắp xếp tăng dần. */
export async function getArchivedOhlcv(symbol: string, limit = 250): Promise<OhlcvBar[] | null> {
  try {
    const { db, stockOhlcv, drizzle } = await dbAccess();
    const rows = await db
      .select()
      .from(stockOhlcv)
      .where(drizzle.eq(stockOhlcv.symbol, symbol.toUpperCase()))
      .orderBy(drizzle.desc(stockOhlcv.date))
      .limit(limit);
    const bars = rows.map(archiveRowToBar).filter((b): b is OhlcvBar => b != null);
    return bars.reverse();
  } catch {
    return null;
  }
}

/** Đọc quote snapshot đã archive (giới hạn N bản mới nhất). */
export async function getArchivedQuotes(symbol: string, limit = 100): Promise<unknown[] | null> {
  try {
    const { db, stockQuotes, drizzle } = await dbAccess();
    return await db.select().from(stockQuotes).where(drizzle.eq(stockQuotes.symbol, symbol.toUpperCase())).orderBy(drizzle.desc(stockQuotes.ts)).limit(limit);
  } catch {
    return null;
  }
}

/* ------------------------------- daily job -------------------------------- */

interface ArchiveState {
  lastDate: string | null;
  running: boolean;
}

const g = globalThis as typeof globalThis & { __orcaArchiveState?: ArchiveState };
function state(): ArchiveState {
  if (!g.__orcaArchiveState) g.__orcaArchiveState = { lastDate: null, running: false };
  return g.__orcaArchiveState;
}

/**
 * Archive nến ngày cho một nhóm symbol. Async, gọi từ scheduler sau phiên VN
 * (idempotent: dù chạy lại nhiều lần, upsert theo date không tạo trùng).
 */
export async function runDailyArchive(symbols: string[], fetchBars: (sym: string) => Promise<OhlcvBar[] | null>): Promise<{ archived: number; failed: number }> {
  const st = state();
  if (st.running) return { archived: 0, failed: 0 };
  st.running = true;
  let archived = 0;
  let failed = 0;
  try {
    for (const sym of [...new Set(symbols.map((s) => s.toUpperCase()))].slice(0, ARCHIVE_DAILY_LIMIT)) {
      try {
        const bars = await fetchBars(sym);
        if (!bars?.length) {
          failed += 1;
          continue;
        }
        const n = await archiveDailyBars(sym, bars, "scheduler:daily");
        if (n > 0) archived += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    st.lastDate = vnDateKey(Date.now());
    return { archived, failed };
  } finally {
    st.running = false;
  }
}

export function archiveState(): { lastDate: string | null; running: boolean; dailyLimit: number; keyPrefix: string } {
  const st = state();
  return { lastDate: st.lastDate, running: st.running, dailyLimit: ARCHIVE_DAILY_LIMIT, keyPrefix: ARCHIVE_KEY_PREFIX };
}
