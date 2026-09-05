import { ok, notFound } from "@/lib/envelope";
import { getReportById } from "@/lib/services/report-engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const report = await getReportById(id);
  if (!report) return notFound("Không tìm thấy report");
  return ok(report, { source: "orca-report-engine" });
}
