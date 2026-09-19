import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { getVnQuotes } from "./stocks";
import { getVndValuationRatios } from "../providers/vndirect-company";
import { sectorOf } from "../vn/master";

export type ValuationScreenRow = {
  symbol: string;
  sector: string | null;
  price: number | null;
  pe: number | null;
  pb: number | null;
  ps: number | null;
  eps: number | null;
  reportDate: string | null;
  score: number;
};

const DEFAULT_SYMBOLS = "VCB,BID,CTG,TCB,MBB,VPB,ACB,STB,HDB,VIB,LPB,SHB,FPT,HPG,VNM,VIC,VHM,VRE,NVL,PDR,GAS,PLX,MSN,MWG,SSI,VND,HCM,VCI,SHS,BSR,POW,REE,KDH,DXG,DCM,DPM,DGC,VHC,SAB,PNJ,GMD";

function positive(value: number | null | undefined, max: number): number | null {
  return value != null && Number.isFinite(value) && value > 0 && value <= max ? value : null;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await fn(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

export async function screenValuation(opts: { symbols?: string[]; sector?: string; limit?: number }) {
  const symbols = (opts.symbols?.length ? opts.symbols : DEFAULT_SYMBOLS.split(","))
    .map((s) => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, ""))
    .filter((s, i, all) => s.length >= 3 && all.indexOf(s) === i)
    .slice(0, 80);
  const key = `screener:valuation:${symbols.join(",")}`;
  const result = await cached(key, {
    ttlMs: 5 * 60_000,
    staleMs: 30 * 60_000,
    producer: async () => {
      const quotes = await getVnQuotes(symbols).catch(() => null);
      const quoteMap = new Map((quotes?.quotes ?? []).map((q) => [q.symbol, q]));
      const rows = (await mapPool(symbols, 6, async (symbol): Promise<ValuationScreenRow | null> => {
        const ratios = await getVndValuationRatios(symbol).catch(() => null);
        if (!ratios) return null;
        const pe = positive(ratios.pe, 500);
        const pb = positive(ratios.pb, 100);
        const ps = positive(ratios.ps, 200);
        if (pe == null && pb == null && ps == null) return null;
        return { symbol, sector: sectorOf(symbol), price: quoteMap.get(symbol)?.price ?? null, pe, pb, ps, eps: ratios.eps ?? null, reportDate: ratios.reportDate ?? null, score: [pe, pb, ps].filter((v) => v != null).length } satisfies ValuationScreenRow;
      })).filter((row): row is ValuationScreenRow => row !== null);
      rows.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
      return { rows, scanned: symbols.length, skipped: symbols.length - rows.length };
    },
  });
  return {
    ...result.value,
    meta: buildMeta({
      source: "vndirect-ratios",
      cached: result.cached,
      stale: result.stale,
      partial: result.value.skipped > 0,
      note: `P/E/P/B/P/S · ${result.value.rows.length}/${result.value.scanned} mã có ratios · tối đa 6 kết nối song song`,
    }),
  };
}

export { DEFAULT_SYMBOLS };
