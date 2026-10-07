import { ok, unavailable } from "@/lib/envelope";
import { buildMeta } from "@/lib/freshness";
import {
  getStockCompanyPackage,
  profileFromMaster,
  type StockCompanyPackage,
} from "@/lib/services/stock-company";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 25;

function shellPackage(sym: string): { data: StockCompanyPackage; meta: ReturnType<typeof buildMeta> } {
  const profile = profileFromMaster(sym) ?? {
    code: sym,
    floor: null,
    logo: null,
    vnName: sym,
    enName: null,
    foundDate: null,
    taxCode: null,
    vnAddress: null,
    phone: null,
    fax: null,
    website: null,
    email: null,
    employees: null,
    vnSummary: null,
    enSummary: null,
  };
  return {
    data: {
      symbol: sym,
      profile,
      shareholders: [],
      board: [],
      valueChain: null,
      catalysts: [],
      risks: [],
      swot: null,
      notes: ["Hồ sơ tối thiểu từ master nội bộ — đang đồng bộ nguồn live."],
      researchSource: "vn-master-shell",
    },
    meta: buildMeta({
      source: "vn-master-shell",
      sourceTimestampMs: Date.now(),
      note: "shell profile",
      partial: true,
    }),
  };
}

/** Prefer live VNDirect package; master shell only on hard failure. */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const sym = (symbol ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return unavailable("company", "Thiếu mã cổ phiếu");

  try {
    const r = await getStockCompanyPackage(sym);
    if (r?.data?.profile) {
      return ok(r.data, r.meta);
    }
    if (r?.data) {
      const shell = shellPackage(sym);
      return ok({ ...r.data, profile: r.data.profile ?? shell.data.profile }, r.meta);
    }
  } catch (e) {
    console.error("[stocks/profile]", sym, e);
  }

  const shell = shellPackage(sym);
  return ok(shell.data, shell.meta);
}
