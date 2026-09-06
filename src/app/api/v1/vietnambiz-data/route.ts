import { ok } from "@/lib/envelope";
import type { FreshnessStatus } from "@/lib/types";
import { getVnbGoodsSnapshot, getVnbMacro, getVnbRates, VN_DATA_SOURCE } from "@/lib/providers/vietnambiz-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/vietnambiz-data — direct snapshot của VietnamBiz Data portal
 * (WiFeed/WiGroup): /goods (bảng giá hàng hóa đầy đủ incl. nhôm/kẽm),
 * /macro-economic, /currency-interest-rate. Mỗi dataset có trạng thái riêng
 * (allSettled — một trang lỗi không kéo sập các trang khác). Meta chuẩn:
 * sections per dataset + partial/degraded khi thiếu, freshness DELAYED
 * (dữ liệu WiFeed cập nhật theo kỳ — không bao giờ gắn LIVE).
 */
export async function GET() {
  const [goods, macro, rates] = await Promise.allSettled([getVnbGoodsSnapshot(), getVnbMacro(), getVnbRates()]);

  const wrap = <T>(r: PromiseSettledResult<T>, url: string) =>
    r.status === "fulfilled" ? { ok: true as const, data: r.value, url } : { ok: false as const, error: `${r.reason instanceof Error ? r.reason.message : String(r.reason)}`, url };

  const sections: Record<string, FreshnessStatus> = {
    goods: goods.status === "fulfilled" ? "DELAYED" : "UNAVAILABLE",
    macro: macro.status === "fulfilled" ? "DELAYED" : "UNAVAILABLE",
    rates: rates.status === "fulfilled" ? "DELAYED" : "UNAVAILABLE",
  };
  const okCount = [goods, macro, rates].filter((r) => r.status === "fulfilled").length;
  const hasData = okCount > 0;
  const degraded = okCount > 0 && okCount < 3;
  const goodsDates =
    goods.status === "fulfilled" ? goods.value.rows.map((r) => r.dateTs).filter((x): x is number => x != null) : [];
  const latestTs = goodsDates.length ? Math.max(...goodsDates) : null;

  return ok(
    {
      source: VN_DATA_SOURCE,
      provider: "vietnambiz-data",
      baseUrl: "https://data.vietnambiz.vn",
      fetchedAt: new Date().toISOString(),
      note: "Dữ liệu thuộc bản quyền CTCP WiGroup (WiFeed.vn / WiChart.vn) — dùng có ghi nguồn; giá goods & chỉ số cập nhật theo kỳ (phần lớn theo ngày), không realtime nội ngày.",
      goods: wrap(goods, "https://data.vietnambiz.vn/goods"),
      macro: wrap(macro, "https://data.vietnambiz.vn/macro-economic"),
      rates: wrap(rates, "https://data.vietnambiz.vn/currency-interest-rate"),
    },
    {
      source: VN_DATA_SOURCE,
      sourceTimestampMs: latestTs,
      hasData,
      degraded,
      partial: degraded,
      sections,
      slas: { liveSlaMs: 60_000, freshSlaMs: 6 * 3_600_000, delayedSlaMs: 14 * 24 * 3_600_000 },
      note: hasData
        ? degraded
          ? "Chỉ lấy được một phần 3 dataset WiFeed — xem sections."
          : "Dữ liệu WiFeed cập nhật theo kỳ công bố (ngày/quý) — không phải realtime nội ngày."
        : "Cả 3 dataset WiFeed đều chưa khả dụng.",
    },
  );
}
