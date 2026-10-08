import "server-only";
import { cached } from "../cache";
import { fetchVndFullUniverse, type VndUniverseItem } from "../providers/vndirect-universe";
import { getSsiIboardUniverse } from "../providers/ssi-iboard";
import { LIQUID_BOARD } from "../providers/public-vn-feed";

/**
 * VN listed-equity universe service.
 *
 * Chain (public, no API key):
 *  1. VNDirect DStock /v4/stocks (LISTED + recent listings) merged with SSI iBoard boards
 *  2. SSI iBoard HOSE/HNX/UPCoM boards alone
 *  3. LIQUID_BOARD fallback (clearly labelled partial)
 *
 * Cached for 6h (stale 36h) — the universe changes slowly, so screeners, search and
 * cron syncs read one shared snapshot instead of re-crawling the exchanges.
 */

export type VnUniverseRow = VndUniverseItem;

export type VnUniversePack = {
  rows: VnUniverseRow[];
  /** Which chain step produced the rows. */
  source: string;
  partial: boolean;
};

const UNIVERSE_KEY = "vn:universe:v2";
const UNIVERSE_TTL_MS = 6 * 3_600_000;
const UNIVERSE_STALE_MS = 36 * 3_600_000;
/** Below this row count the provider answer is treated as a partial crawl. */
const MIN_FULL_UNIVERSE = 200;

export function liquidBoardUniverse(): VnUniverseRow[] {
  return LIQUID_BOARD.map((symbol) => ({
    symbol,
    name: null,
    exchange: null,
    industry: null,
    listedDate: null,
    status: "listed",
  }));
}

function dedupe(rows: VnUniverseRow[]): VnUniverseRow[] {
  const bySym = new Map<string, VnUniverseRow>();
  for (const r of rows) {
    const symbol = String(r?.symbol ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    if (!symbol || symbol.length < 2) continue;
    const prev = bySym.get(symbol);
    bySym.set(symbol, {
      symbol,
      name: prev?.name ?? r.name ?? null,
      exchange: prev?.exchange ?? r.exchange ?? null,
      industry: prev?.industry ?? r.industry ?? null,
      listedDate: prev?.listedDate ?? r.listedDate ?? null,
      status: prev?.status ?? r.status ?? null,
    });
  }
  return [...bySym.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

async function produceUniverse(): Promise<VnUniversePack> {
  try {
    const rows = await fetchVndFullUniverse();
    if (rows.length) {
      const deduped = dedupe(rows);
      return {
        rows: deduped,
        source: deduped.length >= MIN_FULL_UNIVERSE ? "vndirect+ssi-iboard" : "vndirect-partial",
        partial: deduped.length < MIN_FULL_UNIVERSE,
      };
    }
  } catch {
    /* fall through */
  }
  try {
    const boards = await getSsiIboardUniverse();
    if (boards.length) {
      const rows = dedupe(
        boards.map((b) => ({
          symbol: b.symbol,
          name: b.name,
          exchange: b.exchange,
          industry: null,
          listedDate: b.listedDate,
          status: "listed",
        })),
      );
      return {
        rows,
        source: "ssi-iboard",
        partial: rows.length < MIN_FULL_UNIVERSE,
      };
    }
  } catch {
    /* fall through */
  }
  return { rows: liquidBoardUniverse(), source: "liquid-board-fallback", partial: true };
}

export type VnUniverseResult = VnUniversePack & {
  cached: boolean;
  stale: boolean;
  producedAt: number;
};

export async function getVnUniverse(opts?: { skipCache?: boolean }): Promise<VnUniverseResult> {
  const res = await cached<VnUniversePack>(UNIVERSE_KEY, {
    ttlMs: UNIVERSE_TTL_MS,
    staleMs: UNIVERSE_STALE_MS,
    skipCache: opts?.skipCache,
    producer: produceUniverse,
  });
  return {
    ...res.value,
    cached: res.cached,
    stale: res.stale,
    producedAt: res.producedAt,
  };
}

export type VnUniverseFilter = {
  exchange?: string | null;
  search?: string | null;
  limit?: number | null;
};

export function filterVnUniverse(rows: VnUniverseRow[], filter?: VnUniverseFilter): VnUniverseRow[] {
  const exchange = (filter?.exchange ?? "").trim().toUpperCase();
  const search = (filter?.search ?? "").trim().toUpperCase();
  let out = rows;
  if (exchange && exchange !== "ALL") {
    out = out.filter((r) => String(r.exchange ?? "").toUpperCase().includes(exchange));
  }
  if (search) {
    out = out.filter(
      (r) =>
        r.symbol.includes(search) ||
        String(r.name ?? "")
          .toUpperCase()
          .includes(search),
    );
  }
  const limit = Number(filter?.limit ?? 0);
  if (Number.isFinite(limit) && limit > 0) out = out.slice(0, Math.floor(limit));
  return out;
}
