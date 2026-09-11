import { ok, badRequest, unavailable, fail } from "@/lib/envelope";
import { analyzeFinancialHealthAi } from "@/lib/services/financial-ai";
import { llmConfigured } from "@/lib/ai/gateway";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST/GET /api/v1/stocks/[symbol]/ai-analysis
 * AI phân tích sức khỏe TC + xu hướng từ snapshot BCTC.
 * Fallback deterministic nếu chưa có AI_PROVIDER_KEY.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const sym = symbol?.trim().toUpperCase();
  if (!sym || sym.length > 12) return badRequest("Mã không hợp lệ");

  try {
    const r = await analyzeFinancialHealthAi(sym);
    if (!r) return unavailable("financial-ai", `Không lấy được BCTC/snapshot cho ${sym}.`);
    return ok(
      {
        ...r.analysis,
        llmConfigured: llmConfigured(),
      },
      {
        source: r.meta.source,
        sourceTimestampMs: r.meta.sourceTimestamp ? Date.parse(r.meta.sourceTimestamp) : null,
        cached: r.meta.cached,
        stale: r.meta.stale,
        note: r.meta.note,
      },
    );
  } catch (e) {
    return fail("FINANCIAL_AI_FAILED", e instanceof Error ? e.message : "unknown", 502);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  return GET(req, ctx);
}
