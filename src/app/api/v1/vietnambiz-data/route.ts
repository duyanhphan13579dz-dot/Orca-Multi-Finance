import { ok } from "@/lib/envelope";
import { getVnbGoodsSnapshot, getVnbMacro, getVnbRates, VN_DATA_SOURCE } from "@/lib/providers/vietnambiz-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/vietnambiz-data — direct snapshot của VietnamBiz Data portal
 * (WiFeed/WiGroup): /goods (bảng giá hàng hóa đầy đủ incl. nhôm/kẽm),
 * /macro-economic, /currency-interest-rate. Mỗi dataset có trạng thái riêng
 * (allSettled — một trang lỗi không kéo sập các trang khác).
 * Nguồn đầy đủ + url gốc được trả trong mỗi section.
 */
export async function GET() {
  const [goods, macro, rates] = await Promise.allSettled([getVnbGoodsSnapshot(), getVnbMacro(), getVnbRates()]);

  const wrap = <T>(r: PromiseSettledResult<T>, url: string) =>
    r.status === "fulfilled" ? { ok: true, data: r.value, url } : { ok: false, error: `${r.reason instanceof Error ? r.reason.message : String(r.reason)}`, url };

  return ok({
    source: VN_DATA_SOURCE,
    provider: "vietnambiz-data",
    baseUrl: "https://data.vietnambiz.vn",
    fetchedAt: new Date().toISOString(),
    note: "Dữ liệu thuộc bản quyền CTCP WiGroup (WiFeed.vn / WiChart.vn) — dùng có ghi nguồn; giá goods cập nhật theo ngày (không realtime nội ngày).",
    goods: wrap(goods, "https://data.vietnambiz.vn/goods"),
    macro: wrap(macro, "https://data.vietnambiz.vn/macro-economic"),
    rates: wrap(rates, "https://data.vietnambiz.vn/currency-interest-rate"),
  });
}
