import { ok } from "@/lib/envelope";
import { trainingStatus } from "@/lib/ai/training/pipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const status = await trainingStatus();
  return ok(status, { source: "training-pipeline" });
}
