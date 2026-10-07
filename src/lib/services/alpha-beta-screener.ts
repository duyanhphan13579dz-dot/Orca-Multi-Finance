import "server-only";
import { buildMeta } from "../freshness";
import { computeAlphaBeta, type AlphaBetaSnapshot, type AlphaBetaProfile } from "../engines/alpha-beta";
import { getVnQuotes } from "./stocks";
import { LIQUID_BOARD } from "../providers/public-vn-feed";
import { fetchOhlcvResilient, mapPool } from "./screener-ohlcv";
import { getSecurity, sectorOf } from "../vn/master";
import type { Meta } from "../types";

export interface AlphaBetaScreenRow {
  symbol: string;
  name: string | null;
  sector: string | null;
  price: number | null;
  changePercent: number | null;
  beta: number | null;
  betaAdj: number | null;
  betaUp: number | null;
  betaDown: number | null;
  alphaAnnual: number | null;
  alphaT: number | null;
  r2: number | null;
  n: number;
  profile: AlphaBetaProfile;
  profileVi: string;
  reliable: boolean;
  summary: string;
}

export async function screenAlphaBeta(args?: {
  symbols?: string[];
  profile?: AlphaBetaProfile | "any";
  minAlphaT?: number;
  maxBeta?: number;
  minBeta?: number;
  requireReliable?: boolean;
  limit?: number;
  sector?: string;
}): Promise<{ rows: AlphaBetaScreenRow[]; scanned: number; skipped: number; meta: Meta }> {
  const limit = Math.min(Math.max(args?.limit ?? 40, 5), 80);
  const profileFilter = args?.profile ?? "any";
  const minAlphaT = args?.minAlphaT ?? 0;
  const maxBeta = args?.maxBeta ?? 99;
  const minBeta = args?.minBeta ?? -99;
  const requireReliable = args?.requireReliable ?? false;
  const sectorFilter = args?.sector?.trim() || "";

  let universe = (args?.symbols?.length ? args.symbols : LIQUID_BOARD).map((s) =>
    s.toUpperCase().replace(/[^A-Z0-9]/g, ""),
  );
  universe = [...new Set(universe)].filter(Boolean).slice(0, 120);

  const mktPack = await fetchOhlcvResilient("VNINDEX", 520);
  const mktBars = mktPack.bars;
  if (mktBars.length < 80) {
    return {
      rows: [],
      scanned: 0,
      skipped: universe.length,
      meta: buildMeta({
        source: "alpha-beta-screener",
        sourceTimestampMs: Date.now(),
        note: "Không tải được VNINDEX để làm benchmark",
        partial: true,
      }),
    };
  }

  const quotes = await getVnQuotes(universe).catch(() => null);
  const qMap = new Map(
    (quotes?.quotes ?? []).map((q) => [String(q.symbol).toUpperCase(), q] as const),
  );

  let scanned = 0;
  let skipped = 0;

  const results = await mapPool(universe, 6, async (sym) => {
    try {
      if (sectorFilter) {
        const sec = sectorOf(sym) ?? getSecurity(sym)?.sector ?? "";
        if (!String(sec).toLowerCase().includes(sectorFilter.toLowerCase())) {
          skipped++;
          return null;
        }
      }
      const { bars } = await fetchOhlcvResilient(sym, 520);
      if (bars.length < 80) {
        skipped++;
        return null;
      }
      scanned++;
      const ab = computeAlphaBeta(bars, mktBars, { benchmark: "VNINDEX" });
      if (ab.beta == null) {
        skipped++;
        return null;
      }
      if (profileFilter !== "any" && ab.profile !== profileFilter) return null;
      if (ab.alphaT != null && Math.abs(ab.alphaT) < minAlphaT && minAlphaT > 0) return null;
      if (ab.beta > maxBeta || ab.beta < minBeta) return null;
      if (requireReliable && !ab.quality.reliable) return null;

      const q = qMap.get(sym);
      const sec = sectorOf(sym) ?? getSecurity(sym)?.sector ?? null;
      const row: AlphaBetaScreenRow = {
        symbol: sym,
        name: q?.name ?? getSecurity(sym)?.name ?? null,
        sector: sec,
        price: q?.price ?? bars[bars.length - 1]?.close ?? null,
        changePercent: q?.changePercent ?? null,
        beta: ab.beta,
        betaAdj: ab.betaAdj,
        betaUp: ab.betaUp,
        betaDown: ab.betaDown,
        alphaAnnual: ab.alphaAnnual,
        alphaT: ab.alphaT,
        r2: ab.r2,
        n: ab.n,
        profile: ab.profile,
        profileVi: ab.profileVi,
        reliable: ab.quality.reliable,
        summary: ab.summary,
      };
      return row;
    } catch {
      skipped++;
      return null;
    }
  });

  const rows = results
    .filter((r): r is AlphaBetaScreenRow => r != null)
    .sort((a, b) => {
      const at = (a.alphaT ?? 0) * Math.sign(a.alphaAnnual ?? 0);
      const bt = (b.alphaT ?? 0) * Math.sign(b.alphaAnnual ?? 0);
      if (bt !== at) return bt - at;
      return (a.beta ?? 99) - (b.beta ?? 99);
    })
    .slice(0, limit);

  return {
    rows,
    scanned,
    skipped,
    meta: buildMeta({
      source: "alpha-beta-screener:weekly-capm+vnindex",
      sourceTimestampMs: Date.now(),
      note: `Quét ${scanned} mã · benchmark VNINDEX · nghiên cứu, không phải khuyến nghị`,
    }),
  };
}

export type { AlphaBetaSnapshot, AlphaBetaProfile };
