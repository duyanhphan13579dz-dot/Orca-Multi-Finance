import { ok } from "@/lib/envelope";
import { CAPABILITY_MATRIX, decisionReport, SIMPLIZE_DECISION, SIMPLIZE_EVIDENCE, capabilityReport } from "@/lib/providers/simplize";
import { resolveVnProviderChain } from "@/lib/providers/vn-provider-chain";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/providers/vn — provider audit + capability matrix + migration
 * status cho Vietnam Stock Data Engine.
 *
 * Backend diagnostics only (không thay đổi UI). Kết quả PHASE 12:
 * OPTION_C_EMBED_ONLY — VNDirect giữ primary, Simplize chỉ embed visualization.
 */
export async function GET() {
  const chain = resolveVnProviderChain();
  return ok({
    verdict: SIMPLIZE_DECISION.verdict,
    summary: SIMPLIZE_DECISION.summary,
    partnershipContact: SIMPLIZE_DECISION.partnershipContact,
    activeProvider: chain.order[0] ?? "vndirect",
    providerChain: chain,
    capabilityReport: capabilityReport(),
    capabilityMatrix: CAPABILITY_MATRIX,
    migrationPlan: SIMPLIZE_DECISION.migration,
    embed: {
      available: Boolean(env.simplizeWidgetUrlTemplate),
      templateConfigured: Boolean(env.simplizeWidgetUrlTemplate),
      note: "Widget embed là phương thức duy nhất được Simplize cấp phép (visualization). URL mẫu cần lấy từ trang /widget-embed hoặc Simplize xác nhận trước khi cấu hình SIMPLIZE_WIDGET_URL_TEMPLATE.",
    },
    evidence: Object.values(SIMPLIZE_EVIDENCE),
  });
}
