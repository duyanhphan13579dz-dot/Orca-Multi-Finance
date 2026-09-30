import "server-only";
import { cached } from "../cache";
import { VN_SECURITIES } from "../vn/master";
import { fetchVndFullUniverse, IPO_SEED_2025_2026 } from "../providers/vndirect-universe";

/**
 * Universe cổ phiếu niêm yết toàn sàn (HOSE / HNX / UPCOM) phục vụ
 * BCTC · định giá · bộ lọc fundamental — không giới hạn 1 mã hay VN100.
 */

const EQUITY_TYPE_RE = /stock|equity|cổ phiếu|ordinary|common/i;
const SKIP_RE = /^(VNINDEX|VN30|HNXINDEX|UPCOMINDEX|VN100|VNMID|VNSML)$/i;

function listAllEquitySymbols(): string[] {
  return [...new Set(VN_SECURITIES.map((s) => s.symbol.toUpperCase()))].sort();
}

function isLikelyEquity(symbol: string, type?: string | null, status?: string | null): boolean {
  if (!symbol || symbol.length < 2 || symbol.length > 5) return false;
  if (SKIP_RE.test(symbol)) return false;
  if (!/^[A-Z0-9]{2,5}$/.test(symbol)) return false;
  if (status && /delist|suspended|hủy|ngừng/i.test(status)) return false;
  if (type && !EQUITY_TYPE_RE.test(type) && /bond|trái phiếu|cw|warrant|quỹ|fund|etf/i.test(type)) {
    return false;
  }
  return true;
}

/**
 * Danh sách mã equity đầy đủ: master ∪ VNDirect universe ∪ IPO seed.
 * Cached 6h (stale 3d).
 */
export async function resolveListedEquityUniverse(opts?: {
  max?: number;
}): Promise<{ symbols: string[]; source: string; count: number }> {
  const max = Math.min(Math.max(opts?.max ?? 800, 50), 1200);
  const key = `equity:universe:full:v1:${max}`;

  try {
    const hit = await cached<{ symbols: string[]; source: string }>(key, {
      ttlMs: 6 * 3_600_000,
      staleMs: 3 * 24 * 3_600_000,
      softSwr: true,
      producer: async () => {
        const set = new Set<string>();

        for (const s of listAllEquitySymbols()) {
          if (isLikelyEquity(s)) set.add(s);
        }

        for (const s of IPO_SEED_2025_2026) {
          if (isLikelyEquity(s.symbol, null, s.status)) set.add(s.symbol.toUpperCase());
        }

        try {
          const live = await fetchVndFullUniverse();
          for (const item of live) {
            if (isLikelyEquity(item.symbol, null, item.status)) {
              set.add(item.symbol.toUpperCase());
            }
          }
        } catch {
          /* keep master + seed */
        }

        const symbols = [...set].sort().slice(0, max);
        return {
          symbols,
          source: "master+vndirect-universe+ipo-seed",
        };
      },
    });
    return {
      symbols: hit.value.symbols,
      source: hit.value.source,
      count: hit.value.symbols.length,
    };
  } catch {
    const symbols = listAllEquitySymbols().filter((s) => isLikelyEquity(s)).slice(0, max);
    return { symbols, source: "master-fallback", count: symbols.length };
  }
}

/** Fallback sync (không gọi API) — master only. */
export function listedEquityUniverseSync(max = 400): string[] {
  return listAllEquitySymbols()
    .filter((s) => isLikelyEquity(s))
    .slice(0, max);
}
