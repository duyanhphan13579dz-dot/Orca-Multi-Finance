import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { getVndCompanyProfile, getVndShareholders, type VndCompanyProfile, type VndShareholder } from "../providers/vndirect-company";
import type { Meta } from "../types";
import { getOrGenerateCompanyIntelligence, resolveValueChain, type CompanyIntelligence } from "./company-intelligence";

export interface StockCompanyPackage {
  symbol: string;
  profile: VndCompanyProfile | null;
  shareholders: VndShareholder[];
  board: { name: string; role: string }[];
  valueChain: CompanyIntelligence["valueChain"];
  catalysts: CompanyIntelligence["catalysts"];
  risks: CompanyIntelligence["risks"];
  swot: CompanyIntelligence["swot"] | null;
  notes: string[];
}

export async function getStockCompanyPackage(symbol: string): Promise<{ data: StockCompanyPackage; meta: Meta } | null> {
  const sym = symbol.toUpperCase();
  try {
    const res = await cached(`vn:company:${sym}:v1`, {
      ttlMs: 12 * 3_600_000,
      staleMs: 30 * 24 * 3_600_000,
      producer: async () => {
        const [profile, shareholders] = await Promise.all([
          getVndCompanyProfile(sym),
          getVndShareholders(sym, 40),
        ]);
        return { profile, shareholders };
      },
    });

    const intelligence = await getOrGenerateCompanyIntelligence(sym);
    const industry = res.value.profile?.vnSummary ?? null;
    const notes: string[] = [];
    if (!res.value.profile) notes.push("Chưa lấy được hồ sơ doanh nghiệp từ VNDirect.");
    if (!res.value.shareholders.length) notes.push("Chưa có danh sách cổ đông lớn.");
    if (!intelligence) notes.push("Chưa đủ BCTC hoặc tin tức để dựng phân tích doanh nghiệp.");
    else notes.push(...intelligence.notes);

    const data: StockCompanyPackage = {
      symbol: sym,
      profile: res.value.profile,
      shareholders: res.value.shareholders,
      board: [],
      valueChain: resolveValueChain(industry),
      catalysts: intelligence?.catalysts ?? [],
      risks: intelligence?.risks ?? [],
      swot: intelligence?.swot ?? null,
      notes,
    };

    const meta = buildMeta({
      source: "vndirect",
      sourceTimestampMs: Date.now(),
      cached: res.cached,
      stale: res.stale,
      note: "Hồ sơ DN + cổ đông lớn (VNDirect)",
      partial: !res.value.profile || !res.value.shareholders.length,
    });
    return { data, meta };
  } catch {
    return null;
  }
}
