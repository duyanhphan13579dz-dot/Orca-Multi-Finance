import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import type { Meta } from "../types";

/**
 * Unified public multi-asset board:
 *   BTC · ETH · XAU · XAG · major FOREX
 */

export type MultiAssetClass = "crypto" | "metal" | "forex";

export type MultiAssetRow = {
  symbol: string;
  label: string;
  assetClass: MultiAssetClass;
  price: number;
  changePercent: number | null;
  source: string;
  updatedAt: string | null;
};

export type MultiAssetBoard = {
  rows: MultiAssetRow[];
  byClass: {
    crypto: MultiAssetRow[];
    metal: MultiAssetRow[];
    forex: MultiAssetRow[];
  };
  sources: string[];
};

type Pack = { board: MultiAssetBoard; at: number };

function lastGoodStore(): { current: Pack | null } {
  const g = globalThis as typeof globalThis & { __orcaMultiAssetLast?: { current: Pack | null } };
  if (!g.__orcaMultiAssetLast) g.__orcaMultiAssetLast = { current: null };
  return g.__orcaMultiAssetLast;
}

function remember(board: MultiAssetBoard) {
  if (!board.rows.length) return;
  lastGoodStore().current = { board, at: Date.now() };
}

function recall(maxAgeMs = 45 * 60_000): MultiAssetBoard | null {
  const lg = lastGoodStore().current;
  if (!lg || Date.now() - lg.at > maxAgeMs) return null;
  return {
    ...lg.board,
    sources: [...lg.board.sources, "last-good"],
  };
}

const FOREX_CORE = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USDCHF",
  "AUDUSD",
  "USDCAD",
  "NZDUSD",
  "USDVND",
] as const;

const METAL_PAIRS = ["XAUUSD", "XAGUSD"] as const;

function row(
  symbol: string,
  label: string,
  assetClass: MultiAssetClass,
  price: number,
  changePercent: number | null,
  source: string,
  updatedAt: string | null,
): MultiAssetRow {
  return { symbol, label, assetClass, price, changePercent, source, updatedAt };
}

async function loadCryptoMajors(): Promise<MultiAssetRow[]> {
  const { getCryptoMarkets } = await import("./crypto");
  const m = await getCryptoMarkets();
  if (!m?.rows?.length) throw new Error("crypto empty");
  const want = new Set(["BTCUSDT", "ETHUSDT"]);
  const out: MultiAssetRow[] = [];
  for (const r of m.rows) {
    if (!want.has(r.symbol)) continue;
    out.push(
      row(
        r.symbol,
        r.symbol === "BTCUSDT" ? "Bitcoin" : "Ethereum",
        "crypto",
        r.price,
        r.changePercent,
        m.meta.source ?? "crypto",
        r.updatedAt,
      ),
    );
  }
  if (out.length < 2) {
    try {
      const { getYahooQuotes } = await import("../providers/yahoo");
      const map = await getYahooQuotes(["BTC-USD", "ETH-USD"]);
      for (const [ys, label, sym] of [
        ["BTC-USD", "Bitcoin", "BTCUSDT"],
        ["ETH-USD", "Ethereum", "ETHUSDT"],
      ] as const) {
        if (out.some((x) => x.symbol === sym)) continue;
        const q = map.get(ys);
        if (!q || !(q.price > 0)) continue;
        out.push(
          row(
            sym,
            label,
            "crypto",
            q.price,
            q.changePercent ?? null,
            "yahoo-crypto",
            q.marketTime ? new Date(q.marketTime).toISOString() : null,
          ),
        );
      }
    } catch {
      /* */
    }
  }
  if (!out.length) throw new Error("crypto majors empty");
  return out;
}

async function loadMetals(): Promise<MultiAssetRow[]> {
  try {
    const { getRealtimeFxQuotes } = await import("../providers/forex");
    const live = await getRealtimeFxQuotes([...METAL_PAIRS]);
    const out: MultiAssetRow[] = [];
    for (const p of METAL_PAIRS) {
      const price = live.rates[p];
      if (price == null || !(price > 0)) continue;
      const tick = live.ticks?.[p];
      out.push(
        row(
          p,
          p === "XAUUSD" ? "Gold (XAU/USD)" : "Silver (XAG/USD)",
          "metal",
          price,
          tick?.dayDiffPercent ?? null,
          live.source || "fx-live",
          live.ts ? new Date(live.ts).toISOString() : null,
        ),
      );
    }
    if (out.length) return out;
  } catch {
    /* Yahoo futures */
  }

  const { getYahooQuotes } = await import("../providers/yahoo");
  const map = await getYahooQuotes(["GC=F", "SI=F"]);
  const out: MultiAssetRow[] = [];
  const gc = map.get("GC=F");
  if (gc?.price && gc.price > 0) {
    out.push(
      row(
        "XAUUSD",
        "Gold (XAU/USD)",
        "metal",
        gc.price,
        gc.changePercent ?? null,
        "yahoo-GC=F",
        gc.marketTime ? new Date(gc.marketTime).toISOString() : null,
      ),
    );
  }
  const si = map.get("SI=F");
  if (si?.price && si.price > 0) {
    out.push(
      row(
        "XAGUSD",
        "Silver (XAG/USD)",
        "metal",
        si.price,
        si.changePercent ?? null,
        "yahoo-SI=F",
        si.marketTime ? new Date(si.marketTime).toISOString() : null,
      ),
    );
  }
  if (!out.length) throw new Error("metals empty");
  return out;
}

async function loadForexMajors(): Promise<MultiAssetRow[]> {
  const { getRealtimeFxQuotes } = await import("../providers/forex");
  const live = await getRealtimeFxQuotes([...FOREX_CORE]);
  const out: MultiAssetRow[] = [];
  for (const p of FOREX_CORE) {
    const price = live.rates[p];
    if (price == null || !(price > 0)) continue;
    const tick = live.ticks?.[p];
    out.push(
      row(
        p,
        p.replace(/^([A-Z]{3})([A-Z]{3})$/, "$1/$2"),
        "forex",
        price,
        tick?.dayDiffPercent ?? null,
        live.source || "fx-live",
        live.ts ? new Date(live.ts).toISOString() : null,
      ),
    );
  }
  if (out.length >= 3) return out;

  try {
    const { getErApiLatest } = await import("../providers/forex");
    const er = await getErApiLatest();
    const usd = er.rates;
    const fill = (pair: string, base: string, quote: string) => {
      if (out.some((x) => x.symbol === pair)) return;
      let price: number | null = null;
      if (quote === "USD" && usd[base]) price = 1 / Number(usd[base]);
      else if (base === "USD" && usd[quote]) price = Number(usd[quote]);
      if (price == null || !(price > 0)) return;
      out.push(
        row(
          pair,
          `${base}/${quote}`,
          "forex",
          price,
          null,
          er.source || "er-api",
          er.ts ? new Date(er.ts).toISOString() : null,
        ),
      );
    };
    fill("EURUSD", "EUR", "USD");
    fill("GBPUSD", "GBP", "USD");
    fill("USDJPY", "USD", "JPY");
    fill("USDCHF", "USD", "CHF");
    fill("AUDUSD", "AUD", "USD");
    fill("USDCAD", "USD", "CAD");
    fill("NZDUSD", "NZD", "USD");
    fill("USDVND", "USD", "VND");
  } catch {
    /* */
  }

  if (!out.length) throw new Error("forex empty");
  return out;
}

function assemble(
  crypto: MultiAssetRow[],
  metal: MultiAssetRow[],
  forex: MultiAssetRow[],
): MultiAssetBoard {
  const rows = [...crypto, ...metal, ...forex];
  const sources = [...new Set(rows.map((r) => r.source))];
  return {
    rows,
    byClass: { crypto, metal, forex },
    sources,
  };
}

export async function getMultiAssetBoard(): Promise<{
  board: MultiAssetBoard;
  meta: Meta;
} | null> {
  try {
    const res = await cached<{ board: MultiAssetBoard }>("multi-asset:board:v1", {
      ttlMs: 15_000,
      staleMs: 20 * 60_000,
      softSwr: true,
      producer: async () => {
        const cryptoP = loadCryptoMajors().catch(() => [] as MultiAssetRow[]);
        const metalP = loadMetals().catch(() => [] as MultiAssetRow[]);
        const forexP = loadForexMajors().catch(() => [] as MultiAssetRow[]);

        const crypto = await cryptoP;
        const [metal, forex] = await Promise.all([metalP, forexP]);

        const board = assemble(crypto, metal, forex);
        if (!board.rows.length) {
          const lg = recall();
          if (lg) return { board: lg };
          throw new Error("multi-asset empty");
        }
        remember(board);
        return { board };
      },
    });

    const board = res.value.board;
    remember(board);
    const partial =
      !board.byClass.crypto.length ||
      !board.byClass.metal.length ||
      board.byClass.forex.length < 3;

    return {
      board,
      meta: buildMeta({
        source: board.sources.join("+") || "multi-asset",
        sourceTimestampMs: Date.now(),
        cached: res.cached,
        stale: res.stale,
        partial,
        note: partial
          ? `partial crypto=${board.byClass.crypto.length} metal=${board.byClass.metal.length} fx=${board.byClass.forex.length}`
          : undefined,
      }),
    };
  } catch {
    const lg = recall();
    if (!lg) return null;
    return {
      board: lg,
      meta: buildMeta({
        source: lg.sources.join("+"),
        sourceTimestampMs: Date.now(),
        stale: true,
        partial: true,
        note: "multi-asset last-good",
      }),
    };
  }
}

export async function getMultiAssetQuote(
  symbolRaw: string,
): Promise<{ row: MultiAssetRow; meta: Meta } | null> {
  const sym = symbolRaw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const aliases: Record<string, string> = {
    BTC: "BTCUSDT",
    ETH: "ETHUSDT",
    XAU: "XAUUSD",
    XAG: "XAGUSD",
    GOLD: "XAUUSD",
    SILVER: "XAGUSD",
  };
  const target = aliases[sym] ?? (sym.endsWith("USDT") || sym.length === 6 ? sym : `${sym}USDT`);

  const pack = await getMultiAssetBoard();
  if (!pack) return null;
  const row =
    pack.board.rows.find((r) => r.symbol === target) ||
    pack.board.rows.find((r) => r.symbol === sym) ||
    pack.board.rows.find((r) => r.symbol.replace(/USDT$/, "") === sym);
  if (!row) return null;
  return { row, meta: pack.meta };
}
