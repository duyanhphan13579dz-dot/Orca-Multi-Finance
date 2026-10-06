import { ok } from "@/lib/envelope";
import { pollAndPersistDerivatives } from "@/lib/services/derivatives";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET|POST /api/v1/derivatives/poll — snapshot + DB persist + alerts */
export async function GET() {
  const { data, meta } = await pollAndPersistDerivatives({ coreOnly: true });
  return ok(data, meta);
}

export async function POST() {
  return GET();
}
