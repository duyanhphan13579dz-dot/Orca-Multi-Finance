import { ok, unavailable } from "@/lib/envelope";
import { getVnIndices, getVnQuotes, vndirectConfigured } from "@/lib/services/stocks";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Market board: VN indices + quotes for requested symbols. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbols = (url.searchParams.get("symbols") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 40);
  if (!vndirectConfigured()) {
    return unavailable(
      "vndirect",
      "VNDirect chưa khả dụng phía server — dữ liệu chứng khoán Việt Nam ở trạng thái UNAVAILABLE (không dùng mock data).",
    );
  }
  const [indices, quotes] = await Promise.all([getVnIndices(), symbols.length ? getVnQuotes(symbols) : Promise.resolve(null)]);
  if (!indices && !quotes) {
    return unavailable("vndirect", `VNDirect (${env.vndirectBaseUrl ?? "finfo-api.vndirect.com.vn"}) không phản hồi — xem trạng thái provider tại /system.`);
  }
  const meta = quotes?.meta ?? indices?.meta;
  return ok({ indices: indices?.items ?? null, quotes: quotes?.quotes ?? null }, {
    source: "vndirect",
    sourceTimestampMs: meta?.sourceTimestamp ? Date.parse(meta.sourceTimestamp) : null,
    cached: meta?.cached,
    stale: meta?.stale,
    degraded: !indices || (symbols.length > 0 && !quotes),
    partial: !indices || (symbols.length > 0 && !quotes),
    note: !indices ? "Indices không khả dụng" : symbols.length && !quotes ? "Quotes không khả dụng" : undefined,
  });
}
