import { ok } from "@/lib/envelope";
import { pollAndPersistDerivatives } from "@/lib/services/derivatives-p5";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const { data, meta } = await pollAndPersistDerivatives({ coreOnly: true });
  return ok(data, meta);
}

export async function POST() {
  return GET();
}
