import { ok } from "@/lib/envelope";
import { clearSessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  await clearSessionCookie();
  return ok({ loggedOut: true }, { source: "orca-auth" });
}
