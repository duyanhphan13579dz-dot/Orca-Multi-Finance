import { ok, unavailable } from "@/lib/envelope";
import { buildMeta } from "@/lib/freshness";
import {
  getStockCompanyPackage,
  profileFromMaster,
  type StockCompanyPackage,
} from "@/lib/services/stock-company";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

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

/**
 * GET /api/v1/stocks/:symbol/profile
 * MUST return 200 with a profile within ~15s for listed symbols.
 * Never leave the client on UNAVAILABLE for codes in the VN master registry.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const sym = (symbol ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return unavailable("company", "Thiếu mã cổ phiếu");

  const budget = new Promise<null>((resolve) => setTimeout(() => resolve(null), 14_000));

  try {
    const raced = await Promise.race([
      getStockCompanyPackage(sym).then((r) => r ?? null),
      budget,
    ]);

    if (raced?.data?.profile) {
      return ok(raced.data, raced.meta);
    }
    if (raced?.data) {
      const shell = shellPackage(sym);
      return ok({ ...raced.data, profile: shell.data.profile }, raced.meta ?? shell.meta);
    }
  } catch (e) {
    console.error("[stocks/profile]", sym, e);
  }

  const shell = shellPackage(sym);
  return ok(shell.data, shell.meta);
}
