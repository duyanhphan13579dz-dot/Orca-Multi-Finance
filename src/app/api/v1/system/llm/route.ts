import { ok } from "@/lib/envelope";
import { llmRegistryInfo } from "@/lib/ai/gateway";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/system/llm — model/provider đã resolve (không lộ API key) */
export async function GET() {
  const info = llmRegistryInfo();
  return ok(info, { source: "orca-llm-registry" });
}
