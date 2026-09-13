import "server-only";
import { VN_SECTOR_MAP, sectorOf } from "../vn/master";
import { getVnQuotes } from "../services/stocks";
import { getFinancialsForSymbol } from "../financial";
import { computeFinancialHealth } from "./fundamental";
import { buildPhase1Valuation, inputsFromHealthAnchors } from "./valuation-phase1";
import { calcPFCF } from "./valuation-phase2";
import type { PeerMetricRow } from "./valuation-phase2";

const MAX_PEERS = 6;

/** Same-sector symbols excluding self, capped for latency. */
export function listSectorPeerSymbols(symbol: string, limit = MAX_PEERS): string[] {
  const sym = symbol.toUpperCase();
  const sector = sectorOf(sym);
  const entry = VN_SECTOR_MAP.find((s) => s.name === sector);
  if (!entry) return [];
  return entry.symbols.filter((s) => s !== sym).slice(0, limit);
}

async function metricForSymbol(symbol: string): Promise<PeerMetricRow | null> {
  try {
    const [quotes, fin] = await Promise.all([
      getVnQuotes([symbol]),
      getFinancialsForSymbol(symbol).catch(() => null),
    ]);
    const price = quotes?.quotes?.[0]?.price ?? 0;
    if (!price || price <= 0) return null;

    const income = (fin?.financials?.income ?? []) as Record<string, unknown>[];
    const balance = (fin?.financials?.balance ?? []) as Record<string, unknown>[];
    const cashflow = (fin?.financials?.cashflow ?? []) as Record<string, unknown>[];
    const health =
      fin?.health ?? computeFinancialHealth({ income, balance, cashflow }, { symbol });
    const a = health.anchors;
    const phase1 = buildPhase1Valuation(
      inputsFromHealthAnchors({
        price,
        anchors: {
          revenue: a.revenue,
          netProfit: a.netProfit,
          equity: a.equity,
          totalDebt: a.totalDebt,
          ocfTtm: a.ocfTtm,
          fcfTtm: a.fcfTtm,
          shares: a.shares,
          epsTtm: a.epsTtm,
          ebitdaTtm: a.ebitdaTtm,
          cash: a.cash ?? null,
        },
      }),
    );
    const mc = phase1.multiples.marketCap.value;
    const pfcf = calcPFCF(mc, a.fcfTtm);

    return {
      symbol,
      pe: phase1.multiples.pe.value,
      pb: phase1.multiples.pb.value,
      ps: phase1.multiples.ps.value,
      evEbitda: phase1.multiples.evEbitda.value,
      pfcf: pfcf.value,
      dividendYield: null,
      marketCap: mc,
    };
  } catch {
    return null;
  }
}

/** Build peer rows for sector comparison. Soft-fail per peer. */
export async function collectPeerMetrics(
  symbol: string,
  limit = MAX_PEERS,
): Promise<{ sector: string; peers: PeerMetricRow[] }> {
  const sector = sectorOf(symbol);
  const symbols = listSectorPeerSymbols(symbol, limit);
  if (!symbols.length) return { sector, peers: [] };

  const settled = await Promise.all(symbols.map((s) => metricForSymbol(s)));
  const peers = settled.filter((p): p is PeerMetricRow => p != null);
  return { sector, peers };
}
