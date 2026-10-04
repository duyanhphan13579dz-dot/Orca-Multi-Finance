import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import {
  getVndCompanyProfile,
  getVndShareholders,
  type VndCompanyProfile,
  type VndShareholder,
} from "../providers/vndirect-company";
import { getVietcapCompany } from "../providers/vietcap";
import { fetchVndirectFinancials, periodsToLegacyRows } from "../financial/vndirect-fs";
import { llmChat, llmConfigured } from "../ai/gateway";
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

function profileFromVietcap(
  sym: string,
  vc: NonNullable<Awaited<ReturnType<typeof getVietcapCompany>>>,
): VndCompanyProfile {
  return {
    code: sym,
    floor: vc.exchange,
    logo: null,
    vnName: vc.name,
    enName: vc.nameEn,
    foundDate: vc.listedDate,
    taxCode: null,
    vnAddress: null,
    phone: null,
    fax: null,
    website: null,
    email: null,
    employees: null,
    vnSummary: vc.sector ? `Ngành: ${vc.sector}` : null,
    enSummary: vc.sector ? `Sector: ${vc.sector}` : null,
  };
}

async function loadCompanyCore(sym: string): Promise<{
  profile: VndCompanyProfile | null;
  shareholders: VndShareholder[];
  sources: string[];
}> {
  const sources: string[] = [];
  const [vndProfile, shareholders, vietcap] = await Promise.all([
    getVndCompanyProfile(sym).catch(() => null),
    getVndShareholders(sym, 50).catch(() => [] as VndShareholder[]),
    getVietcapCompany(sym).catch(() => null),
  ]);

  let profile = enrichFoundDate(vndProfile);
  if (profile) sources.push("vndirect");
  if (shareholders.length) sources.push("vndirect-holders");

  if (!profile && vietcap) {
    profile = profileFromVietcap(sym, vietcap);
    sources.push("vietcap");
  } else if (profile && vietcap) {
    // Fill gaps from Vietcap
    if (!profile.vnName && vietcap.name) profile = { ...profile, vnName: vietcap.name };
    if (!profile.enName && vietcap.nameEn) profile = { ...profile, enName: vietcap.nameEn };
    if (!profile.floor && vietcap.exchange) profile = { ...profile, floor: vietcap.exchange };
    if (!profile.foundDate && vietcap.listedDate) profile = { ...profile, foundDate: vietcap.listedDate };
    sources.push("vietcap-fill");
  }

  return { profile, shareholders, sources };
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
      user: `CONTEXT:\n${JSON.stringify(context)}\n\nPhân tích ngắn gọn, tiếng Việt.`,
      temperature: 0.2,
      maxTokens: 1200,
    });
    const text = typeof raw === "string" ? raw : String(raw ?? "");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as {
      valueChain?: StockCompanyPackage["valueChain"];
      swot?: StockCompanyPackage["swot"];
      catalysts?: string[];
      risks?: string[];
    };
    return {
      valueChain: parsed.valueChain ?? null,
      swot: parsed.swot ?? null,
      catalysts: Array.isArray(parsed.catalysts) ? parsed.catalysts.map(String) : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks.map(String) : [],
    };
  } catch {
    return null;
  }
}

export async function getStockCompanyPackage(
  symbol: string,
): Promise<{ data: StockCompanyPackage; meta: Meta } | null> {
  const sym = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return null;

  try {
    // Cache only successful packs; empty profile uses short TTL via throw+retry path
    let core: { profile: VndCompanyProfile | null; shareholders: VndShareholder[]; sources: string[] };
    try {
      const companyRes = await cached(`vn:company:${sym}:v4`, {
        ttlMs: 2 * 3_600_000,
        staleMs: 24 * 3_600_000,
        softSwr: true,
        producer: async () => {
          const pack = await loadCompanyCore(sym);
          // Do not long-cache total empties — forces re-fetch next time
          if (!pack.profile && !pack.shareholders.length) {
            throw new Error(`company empty ${sym}`);
          }
          return pack;
        },
      });
      core = companyRes.value;
    } catch {
      core = await loadCompanyCore(sym);
    }

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
    if (!core.profile) notes.push("Chưa lấy được hồ sơ doanh nghiệp (VNDirect/Vietcap).");
    if (!core.shareholders.length) notes.push("Chưa có danh sách cổ đông lớn.");
    if (!fin.income.length) notes.push("Chưa lấy được BCTC — SWOT dựa chủ yếu trên hồ sơ.");
    if (core.sources.length) notes.push(`Nguồn: ${[...new Set(core.sources)].join(" + ")}`);

    const det =
      core.profile || fin.income.length
        ? buildDeterministicResearch({
            profile: core.profile,
            shareholders: core.shareholders,
            fin,
          })
        : null;

    let ai: Awaited<ReturnType<typeof enrichCompanyWithAi>> = null;
    if (core.profile && llmConfigured()) {
      try {
        ai = await enrichCompanyWithAi(sym, core.profile, core.shareholders, fin);
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
      : (ai?.swot ?? null);

    const valueChain = det?.valueChain ?? ai?.valueChain ?? null;
    const catalysts = mergeList(det?.catalysts ?? [], ai?.catalysts ?? [], 5);
    const risks = mergeList(det?.risks ?? [], ai?.risks ?? [], 5);

    const researchSource =
      ai && det ? "deterministic+llm" : det ? "deterministic-fs+profile" : ai ? "llm" : "none";

    if (det)
      notes.push("SWOT / catalyst / rủi ro / chuỗi giá trị suy từ hồ sơ + BCTC (không bịa số).");
    if (ai) notes.push("Đã bổ sung gợi ý từ AI — ưu tiên đối chiếu số liệu BCTC.");
    if (!det && !ai) notes.push("Chưa đủ dữ liệu nền để dựng SWOT tự động.");

    const data: StockCompanyPackage = {
      symbol: sym,
      profile: core.profile,
      shareholders: core.shareholders,
      board: [],
      valueChain,
      catalysts,
      risks,
      swot,
      notes,
      researchSource,
    };

    return {
      data,
      meta: buildMeta({
        source: core.sources.join("+") || "company",
        sourceTimestampMs: Date.now(),
        note: det ? "Hồ sơ DN + BCTC → SWOT/catalyst" : "Hồ sơ DN",
        partial: !core.profile || !swot,
      }),
    };
  } catch (e) {
    console.warn("[getStockCompanyPackage]", sym, e instanceof Error ? e.message : e);
    // Degraded shell — never hard-fail the tab
    return {
      data: {
        symbol: sym,
        profile: null,
        shareholders: [],
        board: [],
        valueChain: null,
        catalysts: [],
        risks: [],
        swot: null,
        notes: ["Nguồn hồ sơ tạm gián đoạn — bấm làm mới để thử lại."],
        researchSource: "none",
      },
      meta: buildMeta({
        source: "degraded",
        sourceTimestampMs: Date.now(),
        note: "degraded company shell",
        partial: true,
      }),
    };
  }
}
