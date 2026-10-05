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
import { getSecurity } from "../vn/master";

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

export function profileFromMaster(sym: string): VndCompanyProfile | null {
  const sec = getSecurity(sym);
  if (!sec) return null;
  return {
    code: sym,
    floor: sec.exchange,
    logo: null,
    vnName: sec.name,
    enName: sec.nameEn ?? null,
    foundDate: null,
    taxCode: null,
    vnAddress: null,
    phone: null,
    fax: null,
    website: null,
    email: null,
    employees: null,
    vnSummary: sec.sector ? `Ngành: ${sec.sector}` : null,
    enSummary: sec.sector ? `Sector: ${sec.sector}` : null,
  };
}

export function mergeProfiles(
  base: VndCompanyProfile | null,
  fill: Partial<VndCompanyProfile> | null,
): VndCompanyProfile | null {
  if (!base && !fill) return null;
  if (!base) return fill as VndCompanyProfile;
  if (!fill) return base;
  return {
    ...base,
    floor: base.floor ?? fill.floor ?? null,
    logo: base.logo ?? fill.logo ?? null,
    vnName: base.vnName ?? fill.vnName ?? null,
    enName: base.enName ?? fill.enName ?? null,
    foundDate: base.foundDate ?? fill.foundDate ?? null,
    taxCode: base.taxCode ?? fill.taxCode ?? null,
    vnAddress: base.vnAddress ?? fill.vnAddress ?? null,
    phone: base.phone ?? fill.phone ?? null,
    fax: base.fax ?? fill.fax ?? null,
    website: base.website ?? fill.website ?? null,
    email: base.email ?? fill.email ?? null,
    employees: base.employees ?? fill.employees ?? null,
    vnSummary: base.vnSummary ?? fill.vnSummary ?? null,
    enSummary: base.enSummary ?? fill.enSummary ?? null,
  };
}

async function loadCompanyCore(sym: string): Promise<{
  profile: VndCompanyProfile | null;
  shareholders: VndShareholder[];
  sources: string[];
}> {
  const sources: string[] = [];

  const [vndProfile, shareholdersRaw, vietcap] = await Promise.all([
    getVndCompanyProfile(sym).catch(() => null),
    getVndShareholders(sym, 50).catch(() => [] as VndShareholder[]),
    getVietcapCompany(sym).catch(() => null),
  ]);

  let shareholders = shareholdersRaw;
  let profile = enrichFoundDate(vndProfile);
  if (profile) sources.push("vndirect");
  if (shareholders.length) sources.push("vndirect-holders");

  if (vietcap) {
    const fromVc = profileFromVietcap(sym, vietcap);
    if (!profile) {
      profile = fromVc;
      sources.push("vietcap");
    } else {
      profile = mergeProfiles(profile, fromVc);
      sources.push("vietcap-fill");
    }
  }

  const thin =
    !profile ||
    (!profile.vnName && !profile.vnSummary) ||
    (!profile.website && !profile.vnAddress && !shareholders.length);
  if (thin) {
    const [vnd2, holders2, vc2] = await Promise.all([
      getVndCompanyProfile(sym).catch(() => null),
      getVndShareholders(sym, 50).catch(() => [] as VndShareholder[]),
      getVietcapCompany(sym).catch(() => null),
    ]);
    if (vnd2) {
      profile = mergeProfiles(profile, enrichFoundDate(vnd2));
      if (!sources.includes("vndirect")) sources.push("vndirect");
    }
    if (holders2.length) {
      shareholders = holders2;
      if (!sources.includes("vndirect-holders")) sources.push("vndirect-holders");
    }
    if (vc2) {
      profile = mergeProfiles(profile, profileFromVietcap(sym, vc2));
      if (!sources.includes("vietcap") && !sources.includes("vietcap-fill")) sources.push("vietcap");
    }
  }

  const master = profileFromMaster(sym);
  if (master) {
    if (!profile) {
      profile = master;
      sources.push("vn-master");
    } else {
      const before = profile.vnName;
      profile = mergeProfiles(profile, master)!;
      if (!before && profile.vnName) sources.push("vn-master-fill");
    }
  }

  if (!profile) {
    const m = profileFromMaster(sym);
    if (m) {
      profile = m;
      sources.push("vn-master-guarantee");
    }
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
    const raw = await llmChat("analysis", {
      system,
      user: `CONTEXT:\n${JSON.stringify(context)}\n\nViết SWOT, chuỗi giá trị, catalyst, rủi ro bằng tiếng Việt, ngắn, bám số liệu.`,
      temperature: 0.2,
    });
    const text = raw?.text ?? "";
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      valueChain?: StockCompanyPackage["valueChain"];
      swot?: StockCompanyPackage["swot"];
      catalysts?: string[];
      risks?: string[];
    };

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
  const sym = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return null;

  try {
    let core: { profile: VndCompanyProfile | null; shareholders: VndShareholder[]; sources: string[] };
    try {
      const companyRes = await cached(`vn:company:${sym}:v7`, {
        ttlMs: 30 * 60_000,
        staleMs: 6 * 3_600_000,
        softSwr: true,
        producer: async () => {
          let pack = await loadCompanyCore(sym);
          if (!pack.profile || pack.sources.every((s) => s.startsWith("vn-master"))) {
            const again = await loadCompanyCore(sym);
            if (again.profile && !again.sources.every((s) => s.startsWith("vn-master"))) {
              pack = again;
            } else if (again.shareholders.length > pack.shareholders.length) {
              pack = again;
            } else if (!pack.profile && again.profile) {
              pack = again;
            }
          }
          if (!pack.profile && !pack.shareholders.length) {
            throw new Error(`company empty ${sym}`);
          }
          return pack;
        },
      });
      core = companyRes.value;
    } catch {
      core = await loadCompanyCore(sym);
      if (!core.profile) {
        const m = profileFromMaster(sym);
        if (m) core = { profile: m, shareholders: [], sources: ["vn-master-fallback"] };
      }
    }

    let fin: {
      income: Record<string, unknown>[];
      balance: Record<string, unknown>[];
      cashflow: Record<string, unknown>[];
    } = { income: [], balance: [], cashflow: [] };
    try {
      const fs = await Promise.race([
        fetchVndirectFinancials(sym, { limitPeriods: 8 }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 6_000)),
      ]);
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
    if (!core.profile) notes.push("Chưa lấy được hồ sơ doanh nghiệp (VNDirect/Vietcap/master).");
    if (!core.shareholders.length) notes.push("Chưa có danh sách cổ đông lớn.");
    if (!fin.income.length) notes.push("Chưa lấy được BCTC — SWOT dựa chủ yếu trên hồ sơ.");
    if (core.sources.length) notes.push(`Nguồn: ${[...new Set(core.sources)].join(" + ")}`);

    const det =
      core.profile || fin.income.length
        ? buildDeterministicResearch({
            symbol: sym,
            profile: core.profile,
            shareholders: core.shareholders,
            income: fin.income,
            balance: fin.balance,
            cashflow: fin.cashflow,
          })
        : null;

    let ai: Awaited<ReturnType<typeof enrichCompanyWithAi>> = null;
    if (core.profile && llmConfigured()) {
      try {
        ai = await Promise.race([
          enrichCompanyWithAi(sym, core.profile, core.shareholders, fin),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 4_000)),
        ]);
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

    if (!core.profile) {
      const m = profileFromMaster(sym);
      if (m) {
        core = {
          profile: m,
          shareholders: core.shareholders,
          sources: [...core.sources, "vn-master-end"],
        };
      }
    }

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
    const master = profileFromMaster(sym);
    return {
      data: {
        symbol: sym,
        profile: master,
        shareholders: [],
        board: [],
        valueChain: null,
        catalysts: [],
        risks: [],
        swot: null,
        notes: master
          ? ["Nguồn live tạm gián đoạn — đang dùng hồ sơ master nội bộ. Bấm làm mới để cập nhật."]
          : ["Nguồn hồ sơ tạm gián đoạn — bấm làm mới để thử lại."],
        researchSource: master ? "vn-master-fallback" : "none",
      },
      meta: buildMeta({
        source: master ? "vn-master-fallback" : "degraded",
        sourceTimestampMs: Date.now(),
        note: "degraded company shell",
        partial: true,
      }),
    };
  }
}
