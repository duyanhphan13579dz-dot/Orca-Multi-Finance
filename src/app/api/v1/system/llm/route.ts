import { ok } from "@/lib/envelope";
import { llmRegistryInfo } from "@/lib/ai/gateway";

import { requireInternalSession } from "@/lib/internal-api-auth";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/system/llm — model/provider đã resolve (không lộ API key) */
export async function GET() {
  const unauthorized = await requireInternalSession();
  if (unauthorized) return unauthorized;
  const info = llmRegistryInfo();
  return ok(info, { source: "orca-llm-registry" });
}
