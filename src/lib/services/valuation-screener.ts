import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { hubVnQuotes } from "../data-engine";
import { getVndValuationRatios, priceQuoteToVnd } from "../providers/vndirect-company";
import { getFundamentalSnapshots, mapPool, normalizeSymbols, type FundamentalSnapshot } from "../financial/snapshots";
import { sectorOf } from "../vn/master";

export type ValuationScreenRow = {
  symbol: string;
  sector: string | null;
  price: number | null;
  pe: number | null;
  pb: number | null;
  ps: number | null;
  evEbitda: number | null;
  peg: number | null;
  fcfYieldPct: number | null;
  netDebtToEbitda: number | null;
  eps: number | null;
  niYoyPct: number | null;
  reportDate: string | null;
  sourceNote: string;
  score: number;
};

export type ValuationFilterOpts = {
  symbols?: string[];
  sector?: string;
  minPe?: number;
  maxPe?: number;
  minPb?: number;
  maxPb?: number;
  minPs?: number;
  maxPs?: number;
  minEvEbitda?: number;
  maxEvEbitda?: number;
  maxPeg?: number;
  minFcfYield?: number;
  maxNetDebtEbitda?: number;
  limit?: number;
};

export const DEFAULT_SYMBOLS =
  "VCB,BID,CTG,TCB,MBB,VPB,ACB,STB,HDB,VIB,LPB,SHB,FPT,HPG,VNM,VIC,VHM,VRE,NVL,PDR,GAS,PLX,MSN,MWG,SSI,VND,HCM,VCI,SHS,BSR,POW,REE,KDH,DXG,DCM,DPM,DGC,VHC,SAB,PNJ,GMD";

function positive(value: number | null | undefined, max: number): number | null {
  return value != null && Number.isFinite(value) && value > 0 && value <= max ? value : null;
}

function mergeValuation(
  symbol: string,
  price: number | null,
  ratios: Awaited<ReturnType<typeof getVndValuationRatios>>,
  snap: FundamentalSnapshot | undefined,
): ValuationScreenRow | null {
  let pe = positive(ratios?.pe, 500);
  let pb = positive(ratios?.pb, 100);
  let ps = positive(ratios?.ps, 200);
  let evEbitda = positive(ratios?.evEbitda, 200);
  let eps = ratios?.eps ?? null;
  const notes: string[] = [];
  if (ratios) notes.push("vnd-ratios");

  // BCTC anchors fallback when ratios missing
  if (snap) {
    notes.push("bctc");
    const priceVnd = price != null ? priceQuoteToVnd(price) : null;
    const shares = snap.shares;
    const mcap =
      ratios?.marketCap && ratios.marketCap > 0
        ? ratios.marketCap
        : priceVnd != null && shares != null && shares > 0
          ? priceVnd * shares
          : null;

    if (pe == null && priceVnd != null && snap.epsTtm != null && snap.epsTtm > 0) {
      pe = positive(priceVnd / snap.epsTtm, 500);
      if (pe != null) notes.push("pe@bctc");
    }
    if (pb == null && priceVnd != null && snap.equity != null && shares != null && shares > 0) {
      const bvps = snap.equity / shares;
      if (bvps > 0) {
        pb = positive(priceVnd / bvps, 100);
        if (pb != null) notes.push("pb@bctc");
      }
    }
    if (ps == null && mcap != null && snap.revenue != null && snap.revenue > 0) {
      ps = positive(mcap / snap.revenue, 200);
      if (ps != null) notes.push("ps@bctc");
    }
    if (evEbitda == null && mcap != null && snap.ebitdaTtm != null && snap.ebitdaTtm > 0) {
      const ev = mcap + (snap.totalDebt ?? 0) - (snap.cash ?? 0);
      if (ev > 0) {
        evEbitda = positive(ev / snap.ebitdaTtm, 200);
        if (evEbitda != null) notes.push("eve@bctc");
      }
    }
    if (eps == null && snap.epsTtm != null) eps = snap.epsTtm;
  }

  if (pe == null && pb == null && ps == null && evEbitda == null) return null;

  const niYoy = snap?.niYoyPct ?? null;
  let peg: number | null = null;
  if (pe != null && niYoy != null && niYoy > 0) {
    peg = Number((pe / niYoy).toFixed(2));
  }

  let fcfYieldPct: number | null = null;
  if (snap?.fcfTtm != null) {
    const priceVnd = price != null ? priceQuoteToVnd(price) : null;
    const mcap =
      ratios?.marketCap && ratios.marketCap > 0
        ? ratios.marketCap
        : priceVnd != null && snap.shares != null && snap.shares > 0
          ? priceVnd * snap.shares
          : null;
    if (mcap != null && mcap > 0) {
      fcfYieldPct = Number(((snap.fcfTtm / mcap) * 100).toFixed(2));
    }
  }

  const netDebtToEbitda = snap?.netDebtToEbitda ?? null;

  // Score: prefer reasonable multiples + growth + FCF
  let score = 0;
  let parts = 0;
  const add = (cond: boolean, pts: number) => {
    if (cond) {
      score += pts;
      parts += 1;
    }
  };
  add(pe != null && pe > 0 && pe < 12, 25);
  add(pe != null && pe >= 12 && pe < 18, 15);
  add(pb != null && pb > 0 && pb < 1.5, 15);
  add(pb != null && pb >= 1.5 && pb < 2.5, 8);
  add(evEbitda != null && evEbitda > 0 && evEbitda < 8, 15);
  add(peg != null && peg > 0 && peg < 1, 15);
  add(peg != null && peg >= 1 && peg < 1.5, 8);
  add(fcfYieldPct != null && fcfYieldPct >= 5, 15);
  add(fcfYieldPct != null && fcfYieldPct >= 2 && fcfYieldPct < 5, 8);
  add(netDebtToEbitda != null && netDebtToEbitda < 2, 10);
  if (parts === 0) score = [pe, pb, ps, evEbitda].filter((v) => v != null).length * 10;

  return {
    symbol,
    sector: sectorOf(symbol),
    price,
    pe,
    pb,
    ps,
    evEbitda,
    peg,
    fcfYieldPct,
    netDebtToEbitda,
    eps,
    niYoyPct: niYoy,
    reportDate: ratios?.reportDate ?? snap?.reportDate ?? null,
    sourceNote: notes.join("+") || "—",
    score: Math.min(100, score),
  };
}

function passes(row: ValuationScreenRow, f: ValuationFilterOpts): boolean {
  if (f.sector && row.sector !== f.sector) return false;
  const check = (val: number | null, min?: number, max?: number) => {
    if (min != null && Number.isFinite(min) && (val == null || val < min)) return false;
    if (max != null && Number.isFinite(max) && (val == null || val > max)) return false;
    return true;
  };
  if (!check(row.pe, f.minPe, f.maxPe)) return false;
  if (!check(row.pb, f.minPb, f.maxPb)) return false;
  if (!check(row.ps, f.minPs, f.maxPs)) return false;
  if (!check(row.evEbitda, f.minEvEbitda, f.maxEvEbitda)) return false;
  if (f.maxPeg != null && Number.isFinite(f.maxPeg) && (row.peg == null || row.peg > f.maxPeg)) return false;
  if (f.minFcfYield != null && Number.isFinite(f.minFcfYield) && (row.fcfYieldPct == null || row.fcfYieldPct < f.minFcfYield))
    return false;
  if (
    f.maxNetDebtEbitda != null &&
    Number.isFinite(f.maxNetDebtEbitda) &&
    (row.netDebtToEbitda == null || row.netDebtToEbitda > f.maxNetDebtEbitda)
  )
    return false;
  return true;
}

export async function screenValuation(opts: ValuationFilterOpts = {}) {
  const symbols = normalizeSymbols(opts.symbols, DEFAULT_SYMBOLS.split(","), 80);
  const key = `screener:valuation:v2:${symbols.join(",")}`;

  const result = await cached(key, {
    ttlMs: 8 * 60_000,
    staleMs: 40 * 60_000,
    producer: async () => {
      const [quotes, snapPack] = await Promise.all([
        hubVnQuotes(symbols).catch(() => null),
        getFundamentalSnapshots(symbols, { concurrency: 5 }),
      ]);
      const quoteMap = new Map((quotes?.quotes ?? []).map((q) => [q.symbol, q]));
      const snapMap = new Map(snapPack.snapshots.map((s) => [s.symbol, s]));

      const rows = (
        await mapPool(symbols, 6, async (symbol): Promise<ValuationScreenRow | null> => {
          const ratios = await getVndValuationRatios(symbol).catch(() => null);
          const price = quoteMap.get(symbol)?.price ?? null;
          return mergeValuation(symbol, price, ratios, snapMap.get(symbol));
        })
      ).filter((row): row is ValuationScreenRow => row !== null);

      rows.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
      return {
        allRows: rows,
        scanned: symbols.length,
        withData: rows.length,
        bctcHit: snapPack.hit,
      };
    },
  });

  let rows = result.value.allRows.filter((r) => passes(r, opts));
  if (opts.sector) rows = rows.filter((r) => r.sector === opts.sector);
  const limit = Math.min(opts.limit ?? 80, 100);
  rows = rows.slice(0, limit);

  return {
    rows,
    scanned: result.value.scanned,
    skipped: result.value.scanned - result.value.withData,
    withData: result.value.withData,
    bctcHit: result.value.bctcHit,
    meta: buildMeta({
      source: "vndirect-ratios+bctc-snapshots",
      cached: result.cached,
      stale: result.stale,
      partial: result.value.scanned > result.value.withData,
      note: `P/E·P/B·P/S·EV/EBITDA + PEG/FCF yield từ BCTC · ${rows.length} khớp / ${result.value.withData} có data · BCTC ${result.value.bctcHit}`,
    }),
  };
}
