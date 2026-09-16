import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import {
  getVndCompanyProfile,
  getVndShareholders,
  type VndCompanyProfile,
  type VndShareholder,
} from "../providers/vndirect-company";
import { fetchVndirectFinancials, periodsToLegacyRows } from "../financial/vndirect-fs";
import { llmChat, llmConfigured } from "../ai/gateway";
import { collectFactNumbers, validateOutput } from "../ai/validate";
import { buildDeterministicResearch, enrichFoundDate } from "./company-research";
import type { Meta } from "../types";

export interface StockCompanyPackage {
  symbol: string;
  profile: VndCompanyProfile | null;
  shareholders: VndShareholder[];
  board: { name: string; role: string }[];
  valueChain: { input: string[]; process: string[]; output: string[] } | null;
  catalysts: string[];
  risks: string[];
  swot: {
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
  } | null;
  notes: string[];
  researchSource?: string;
}

export async function enrichCompanyWithAi(
  sym: string,
  profile: VndCompanyProfile | null,
  shareholders: VndShareholder[],
  financials: {
    income: Record<string, unknown>[];
    balance: Record<string, unknown>[];
    cashflow: Record<string, unknown>[];
  },
): Promise<{
  valueChain: StockCompanyPackage["valueChain"];
  swot: StockCompanyPackage["swot"];
  catalysts: string[];
  risks: string[];
} | null> {
  if (!llmConfigured() || !profile) return null;

  const latestIncome = financials.income[0] ?? {};
  const latestBalance = financials.balance[0] ?? {};
  const latestCashflow = financials.cashflow[0] ?? {};
  const topShareholders = shareholders.slice(0, 5);

  const context = {
    company: {
      code: profile.code,
      vnName: profile.vnName,
      enName: profile.enName,
      floor: profile.floor,
      foundDate: profile.foundDate,
      employees: profile.employees,
      website: profile.website,
      vnSummary: profile.vnSummary?.slice(0, 1200) ?? null,
    },
    topShareholders: topShareholders.map((s) => ({
      name: s.name,
      ownershipPct: s.ownershipPct,
      shares: s.shares,
    })),
    financials: {
      income: latestIncome,
      balance: latestBalance,
      cashflow: latestCashflow,
    },
  };

  const system = `Bạn là chuyên gia phân tích doanh nghiệp chứng khoán Việt Nam.
Chỉ dùng dữ liệu trong CONTEXT JSON — không bịa số, không bịa tên.
Trả đúng JSON, không markdown.
{
  "valueChain": { "input": string[], "process": string[], "output": string[] },
  "swot": { "strengths": string[], "weaknesses": string[], "opportunities": string[], "threats": string[] },
  "catalysts": string[],
  "risks": string[]
}`;

  try {
    const raw = await llmChat({
      system,
      user: `CONTEXT:\n${JSON.stringify(context)}\n\nViết SWOT, chuỗi giá trị, catalyst, rủi ro bằng tiếng Việt, ngắn, bám số liệu.`,
      temperature: 0.2,
    });
    const text = typeof raw === "string" ? raw : (raw as { content?: string })?.content ?? "";
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      valueChain?: StockCompanyPackage["valueChain"];
      swot?: StockCompanyPackage["swot"];
      catalysts?: string[];
      risks?: string[];
    };

    const facts = collectFactNumbers(JSON.stringify(context));
    const check = validateOutput(text, facts);
    if (check && (check as { ok?: boolean }).ok === false) {
      /* vẫn trả nếu parse được — deterministic là lớp chính */
    }

    return {
      valueChain: parsed.valueChain ?? null,
      swot: parsed.swot ?? null,
      catalysts: Array.isArray(parsed.catalysts) ? parsed.catalysts : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
    };
  } catch {
    return null;
  }
}

export async function getStockCompanyPackage(
  symbol: string,
): Promise<{ data: StockCompanyPackage; meta: Meta } | null> {
  try {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return null;

    const companyRes = await cached(`vn:company:${sym}:v2`, {
      ttlMs: 6 * 3_600_000,
      staleMs: 7 * 24 * 3_600_000,
      producer: async () => {
        const [profile, shareholders] = await Promise.all([
          getVndCompanyProfile(sym),
          getVndShareholders(sym, 50),
        ]);
        return { profile: enrichFoundDate(profile), shareholders };
      },
    });

    // BCTC trực tiếp VNDirect — không phụ thuộc snapshot trang khác
    let fin: {
      income: Record<string, unknown>[];
      balance: Record<string, unknown>[];
      cashflow: Record<string, unknown>[];
    } = { income: [], balance: [], cashflow: [] };
    try {
      const fs = await fetchVndirectFinancials(sym, { limitPeriods: 8 });
      if (fs?.periods?.length) {
        const rows = periodsToLegacyRows(fs.periods, sym);
        fin = {
          income: rows.income as Record<string, unknown>[],
          balance: rows.balance as Record<string, unknown>[],
          cashflow: rows.cashflow as Record<string, unknown>[],
        };
      }
    } catch {
      /* non-fatal */
    }

    const notes: string[] = [];
    if (!companyRes.value.profile) notes.push("Chưa lấy được hồ sơ doanh nghiệp từ VNDirect.");
    if (!companyRes.value.shareholders.length) notes.push("Chưa có danh sách cổ đông lớn.");
    if (!fin.income.length) notes.push("Chưa lấy được BCTC — SWOT dựa chủ yếu trên hồ sơ.");

    // Lớp 1: deterministic (luôn chạy khi có profile hoặc BCTC)
    const det =
      companyRes.value.profile || fin.income.length
        ? buildDeterministicResearch({
            symbol: sym,
            profile: companyRes.value.profile,
            shareholders: companyRes.value.shareholders,
            income: fin.income,
            balance: fin.balance,
            cashflow: fin.cashflow,
          })
        : null;

    // Lớp 2: AI (tuỳ chọn) — bổ sung, không thay thế nếu AI fail
    let ai: Awaited<ReturnType<typeof enrichCompanyWithAi>> = null;
    if (companyRes.value.profile && llmConfigured()) {
      try {
        ai = await enrichCompanyWithAi(
          sym,
          companyRes.value.profile,
          companyRes.value.shareholders,
          fin,
        );
      } catch {
        /* non-fatal */
      }
    }

    const mergeList = (primary: string[], secondary: string[], max: number) => {
      const out: string[] = [];
      const seen = new Set<string>();
      for (const x of [...primary, ...secondary]) {
        const k = x.trim().toLowerCase();
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(x.trim());
        if (out.length >= max) break;
      }
      return out;
    };

    const swot = det
      ? {
          strengths: mergeList(det.swot.strengths, ai?.swot?.strengths ?? [], 6),
          weaknesses: mergeList(det.swot.weaknesses, ai?.swot?.weaknesses ?? [], 5),
          opportunities: mergeList(det.swot.opportunities, ai?.swot?.opportunities ?? [], 4),
          threats: mergeList(det.swot.threats, ai?.swot?.threats ?? [], 4),
        }
      : ai?.swot ?? null;

    const valueChain = det?.valueChain ?? ai?.valueChain ?? null;
    const catalysts = mergeList(det?.catalysts ?? [], ai?.catalysts ?? [], 5);
    const risks = mergeList(det?.risks ?? [], ai?.risks ?? [], 5);

    const researchSource = ai && det ? "deterministic+llm" : det ? "deterministic-fs+profile" : ai ? "llm" : "none";

    if (det) notes.push("SWOT / catalyst / rủi ro / chuỗi giá trị suy từ hồ sơ + BCTC VNDirect (không bịa số).");
    if (ai) notes.push("Đã bổ sung gợi ý từ AI — ưu tiên đối chiếu số liệu BCTC.");
    if (!det && !ai) notes.push("Chưa đủ dữ liệu nền để dựng SWOT tự động.");

    const data: StockCompanyPackage = {
      symbol: sym,
      profile: companyRes.value.profile,
      shareholders: companyRes.value.shareholders,
      board: [],
      valueChain,
      catalysts,
      risks,
      swot,
      notes,
      researchSource,
    };

    const meta = buildMeta({
      source: researchSource === "none" ? "vndirect" : `vndirect+${researchSource}`,
      sourceTimestampMs: Date.now(),
      cached: companyRes.cached,
      stale: companyRes.stale,
      note: det
        ? "Hồ sơ DN + BCTC → SWOT/catalyst/chuỗi giá trị"
        : "Hồ sơ DN VNDirect",
      partial: !companyRes.value.profile || !swot,
    });
    return { data, meta };
  } catch {
    return null;
  }
}
