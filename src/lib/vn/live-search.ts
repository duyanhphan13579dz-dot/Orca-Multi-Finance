import "server-only";
import { cached } from "../cache";
import { fetchVndFullUniverse, lookupVndSymbol, IPO_SEED_2025_2026, type VndUniverseItem } from "../providers/vndirect-universe";
import { searchSecurities, type VnSecurity } from "./master";

export type LiveSearchHit = {
  symbol: string;
  name: string | null;
  exchange: string | null;
  industry: string | null;
  listedDate: string | null;
  source: "static" | "universe" | "lookup" | "seed";
};

function toHit(item: VndUniverseItem, source: LiveSearchHit["source"]): LiveSearchHit {
  return {
    symbol: item.symbol,
    name: item.name,
    exchange: item.exchange,
    industry: item.industry,
    listedDate: item.listedDate,
    source,
  };
}

async function getUniverseCached(): Promise<VndUniverseItem[]> {
  const res = await cached("vn:universe:full:v3", {
    ttlMs: 20 * 60_000,
    staleMs: 2 * 3_600_000,
    producer: () => fetchVndFullUniverse(),
  });
  return res.value;
}

/**
 * Tìm mã: static master + universe live + lookup trực tiếp VNDirect.
 * Đảm bảo HPA/VCK/VPX/TCX/DMX… luôn tìm được.
 */
export async function liveSearchVnSymbols(query: string, limit = 15): Promise<LiveSearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const upper = q.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const hits = new Map<string, LiveSearchHit>();

  // 1) Static
  for (const s of searchSecurities(q, limit)) {
    hits.set(s.symbol, {
      symbol: s.symbol,
      name: s.name,
      exchange: s.exchange,
      industry: s.sector,
      listedDate: null,
      source: "static",
    });
  }

  // 2) Seed IPO exact/prefix
  for (const s of IPO_SEED_2025_2026) {
    if (s.symbol === upper || (upper.length >= 2 && s.symbol.startsWith(upper))) {
      hits.set(s.symbol, toHit(s, "seed"));
    }
  }

  // 3) Live universe
  try {
    const uni = await getUniverseCached();
    const qLower = q.toLowerCase();
    for (const item of uni) {
      let score = 0;
      if (item.symbol === upper) score = 100;
      else if (upper.length >= 2 && item.symbol.startsWith(upper)) score = 70;
      else if (item.name && item.name.toLowerCase().includes(qLower) && qLower.length >= 2) score = 40;
      if (score > 0) {
        const prev = hits.get(item.symbol);
        if (!prev || prev.source === "static") hits.set(item.symbol, toHit(item, "universe"));
      }
    }
  } catch {
    /* non-fatal */
  }

  // 4) Exact ticker → lookup VNDirect (mã mới chưa vào cache)
  if (upper.length >= 2 && upper.length <= 12 && !hits.has(upper)) {
    const live = await lookupVndSymbol(upper);
    if (live) hits.set(live.symbol, toHit(live, "lookup"));
  }

  // Rank: exact > prefix > rest
  return [...hits.values()]
    .sort((a, b) => {
      const sa = a.symbol === upper ? 100 : a.symbol.startsWith(upper) ? 60 : 10;
      const sb = b.symbol === upper ? 100 : b.symbol.startsWith(upper) ? 60 : 10;
      if (sb !== sa) return sb - sa;
      return a.symbol.localeCompare(b.symbol);
    })
    .slice(0, limit);
}

/** Resolve 1 mã — dùng khi mở /stocks/XXX trực tiếp */
export async function resolveVnSymbol(symbol: string): Promise<LiveSearchHit | null> {
  const hits = await liveSearchVnSymbols(symbol, 5);
  const upper = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return hits.find((h) => h.symbol === upper) ?? hits[0] ?? null;
}
