import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { getVndCompanyProfile, getVndShareholders, type VndCompanyProfile, type VndShareholder } from "../providers/vndirect-company";
import { getVnStockDetail } from "./stocks";
import { llmChat, llmConfigured } from "../ai/gateway";
import { collectFactNumbers, validateOutput } from "../ai/validate";
import type { Meta } from "../types";

export interface StockCompanyPackage {
  symbol: string;
  profile: VndCompanyProfile | null;
  shareholders: VndShareholder[];
  /** Board placeholder — kept for future SSI / IR sources */
  board: { name: string; role: string }[];
  valueChain: { input: string[]; process: string[]; output: string[] } | null;
  catalysts: string[];
  risks: string[];
  swot: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] } | null;
  notes: string[];
}

const SYS_COMPANY =
  `Bạn là chuyên gia phân tích doanh nghiệp chứng khoán Việt Nam, đang giải thích nhanh với nhà đầu tư qua app ORCA.
Bạn chỉ nhận thông tin từ CONTEXT JSON bên dưới — không bịa số, không bịa tên, không đoán dữ liệu không có.
Chỉ dùng tiếng Việt.

Nhiệm vụ: từ hồ sơ công ty + cổ đông lớn + snapshot báo cáo tài chính, viết ngắn gọn:
1) Chuỗi giá trị (value chain): gợi ý input / process / output — 3-5 ý ngắn, chỉ rút từ những gì context cho thấy.
2) SWOT: 2-4 ý mỗi ô, thật, cụ thể.
3) Catalyst tăng trưởng: 3-5 ý ngắn.
4) Rủi ro: 3-5 ý ngắn.

CONTEXT:
${JSON.stringify({ placeholder: true })}

Trả DEXACT JSON, không markdown:
{
  "valueChain": { "input": [...], "process": [...], "output": [...] },
  "swot": { "strengths": [...], "weaknesses": [...], "opportunities": [...], "threats": [...] },
  "catalysts": [...],
  "risks": [...]
}
`;

export async function enrichCompanyWithAi(
  sym: string,
  profile: VndCompanyProfile | null,
  shareholders: VndShareholder[],
  financials: { income: Record<string, unknown>[]; balance: Record<string, unknown>[]; cashflow: Record<string, unknown>[] },
): Promise<{ valueChain: StockCompanyPackage["valueChain"]; swot: StockCompanyPackage["swot"]; catalysts: string[]; risks: string[] } | null> {
  if (!llmConfigured() || !profile) return null;

  const latestIncome = financials.income[0] ?? {};
  const latestBalance = financials.balance[0] ?? {};
  const latestCashflow = financials.cashflow[0] ?? {};
  const topShareholders = shareholders.slice(0, 5);

  const context = {
    company: profile,
    topShareholders: topShareholders.map((s) => ({
      name: s.name,
      role: s.role,
      ownershipPct: s.ownershipPct,
    })),
    financials: {
      latestPeriod: latestIncome.period ?? latestIncome.year ?? null,
      netRevenue: latestIncome.netRevenue ?? latestIncome.revenue ?? null,
      grossProfit: latestIncome.grossProfit ?? null,
      operatingProfit: latestIncome.operatingProfit ?? latestIncome.ebit ?? null,
      netIncome: latestIncome.netIncome ?? latestIncome.netProfit ?? null,
      totalAssets: latestBalance.totalAssets ?? null,
      equity: latestBalance.equity ?? null,
      totalLiabilities: latestBalance.totalLiabilities ?? null,
      operatingCashFlow: latestCashflow.operatingCashFlow ?? null,
      freeCashFlow: latestCashflow.freeCashFlow ?? null,
    },
  };

  const user = `Hồ sơ doanh nghiệp và báo cáo tài chính tóm tắt:\\n${JSON.stringify(context, null, 2).slice(0, 9000)}\\n\\nViết JSON theo schema.`;

  let llm = await llmChat("analysis", {
    system: SYS_COMPANY,
    user,
    temperature: 0.35,
    maxTokens: 900,
    timeoutMs: 25_000,
  });
  if (!llm) {
    llm = await llmChat("report", {
      system: SYS_COMPANY,
      user,
      temperature: 0.35,
      maxTokens: 900,
      timeoutMs: 25_000,
    });
  }
  if (!llm) return null;

  const facts = collectFactNumbers(context);
  const val = validateOutput(llm.text, facts);
  if (!val.ok && val.unsupported.length > 0) {
    const repair = await llmChat("analysis", {
      system: `${SYS_COMPANY}\\nSTRICT REPAIR: chỉ dùng số trong CONTEXT. Claim lỗi: ${val.unsupported.slice(0, 6).map((u) => u.raw).join(", ")}.`,
      user,
      temperature: 0.2,
      maxTokens: 800,
      timeoutMs: 20_000,
    });
    if (repair) llm = repair;
  }

  const raw = llm.text
    .replace(/```json\s*/i, "")
    .replace(/```$/, "")
    .trim();
  const m = raw.match(/\{[\s\S]*"valueChain"[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as {
      valueChain?: { input?: string[]; process?: string[]; output?: string[] };
      swot?: { strengths?: string[]; weaknesses?: string[]; opportunities?: string[]; threats?: string[] };
      catalysts?: string[];
      risks?: string[];
    };
    const vc = j.valueChain ?? { input: [], process: [], output: [] };
    const sw = j.swot ?? { strengths: [], weaknesses: [], opportunities: [], threats: [] };
    return {
      valueChain: {
        input: Array.isArray(vc.input) ? vc.input.filter(Boolean).slice(0, 6) : [],
        process: Array.isArray(vc.process) ? vc.process.filter(Boolean).slice(0, 6) : [],
        output: Array.isArray(vc.output) ? vc.output.filter(Boolean).slice(0, 6) : [],
      },
      swot: {
        strengths: Array.isArray(sw.strengths) ? sw.strengths.filter(Boolean).slice(0, 5) : [],
        weaknesses: Array.isArray(sw.weaknesses) ? sw.weaknesses.filter(Boolean).slice(0, 5) : [],
        opportunities: Array.isArray(sw.opportunities) ? sw.opportunities.filter(Boolean).slice(0, 5) : [],
        threats: Array.isArray(sw.threats) ? sw.threats.filter(Boolean).slice(0, 5) : [],
      },
      catalysts: Array.isArray(j.catalysts) ? j.catalysts.filter(Boolean).slice(0, 8) : [],
      risks: Array.isArray(j.risks) ? j.risks.filter(Boolean).slice(0, 8) : [],
    };
  } catch {
    return null;
  }
}

export async function getStockCompanyPackage(symbol: string): Promise<{ data: StockCompanyPackage; meta: Meta } | null> {
  const sym = symbol.toUpperCase();
  try {
    const companyRes = await cached(`vn:company:${sym}:v1`, {
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

    let fin: { income: Record<string, unknown>[]; balance: Record<string, unknown>[]; cashflow: Record<string, unknown>[] } =
      { income: [], balance: [], cashflow: [] };
    if (companyRes.value.profile) {
      try {
        const detail = await getVnStockDetail(sym);
        if (detail?.detail) {
          fin = {
            income: detail.detail.financials.income ?? [],
            balance: detail.detail.financials.balance ?? [],
            cashflow: detail.detail.financials.cashflow ?? [],
          };
        }
      } catch {
        /* non-fatal */
      }
    }

    const notes: string[] = [];
    if (!companyRes.value.profile) notes.push("Chưa lấy được hồ sơ doanh nghiệp từ VNDirect.");
    if (!companyRes.value.shareholders.length) notes.push("Chưa có danh sách cổ đông lớn.");

    let ai: Awaited<ReturnType<typeof enrichCompanyWithAi>> = null;
    if (!notes.length) {
      try {
        ai = await enrichCompanyWithAi(sym, companyRes.value.profile, companyRes.value.shareholders, fin);
      } catch {
        /* non-fatal */
      }
    }

    const data: StockCompanyPackage = {
      symbol: sym,
      profile: companyRes.value.profile,
      shareholders: companyRes.value.shareholders,
      board: [],
      valueChain: ai?.valueChain ?? null,
      catalysts: ai?.catalysts ?? [],
      risks: ai?.risks ?? [],
      swot: ai?.swot ?? null,
      notes: [
        ...notes,
        ...(ai
          ? ["SWOT / catalyst / chuỗi giá trị từ AI (có thể chưa chính xác — cần kiểm tra nguồn gốc)"]
          : [
              "HĐQT, chuỗi giá trị, SWOT, catalyst: chưa có phân tích tự động (thiếu key AI hoặc dữ liệu nền).",
            ]),
      ],
    };

    const meta = buildMeta({
      source:
        ai
          ? "vndirect+llm"
          : "vndirect",
      sourceTimestampMs: Date.now(),
      cached: companyRes.cached,
      stale: companyRes.stale,
      note: ai ? "Hồ sơ DN + AI phân tích swot / catalyst / chuỗi giá trị" : "Hồ sơ DN + cổ đông lớn (VNDirect)",
      partial: !companyRes.value.profile || !companyRes.value.shareholders.length || !ai,
    });
    return { data, meta };
  } catch {
    return null;
  }
}
