import { ok } from "@/lib/envelope";
import { buildMeta } from "@/lib/freshness";
import { probeSsiDerFeed, SSI_DERIVATIVES } from "@/lib/providers/ssi-derivatives";
import { probeDnseDer, DNSE_DER } from "@/lib/providers/dnse-derivatives";
import { probeTcbsDer, TCBS_DER } from "@/lib/providers/tcbs-derivatives";
import { ssiFcConfigured } from "@/lib/providers/ssi-fcdata";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/derivatives/feeds-status */
export async function GET() {
  const [ssi, dnse, tcbs] = await Promise.all([
    probeSsiDerFeed(),
    probeDnseDer(),
    probeTcbsDer(),
  ]);

  const data = {
    cascade: [
      "ssi-fcdata-der",
      "dnse-openapi-der",
      "tcbs-openapi-der",
      "entrade-derivative-public",
      "derivatives-external",
      "vndirect-dchart-public",
    ],
    ssi: { ...ssi, id: SSI_DERIVATIVES },
    dnse: { ...dnse, id: DNSE_DER },
    tcbs: { ...tcbs, id: TCBS_DER },
    publicAlwaysOn: ["entrade-derivative-public", "vndirect-dchart-public"],
    ssiCredentialsPresent: ssiFcConfigured(),
  };

  const anyPaid = ssi.tokenOk || dnse.reachable || tcbs.reachable;
  const meta = buildMeta({
    source: "derivatives-feeds",
    sourceTimestampMs: Date.now(),
    cached: false,
    stale: false,
    partial: !anyPaid,
    note: anyPaid
      ? "At least one paid/broker feed responded"
      : "Public-only mode until SSI/DNSE/TCBS configured",
    slas: { liveSlaMs: 30_000, freshSlaMs: 120_000, delayedSlaMs: 600_000 },
  });
  return ok(data, meta);
}
