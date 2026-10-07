import { ok, unavailable } from "@/lib/envelope";
import { CONVERTIBLE_CURRENCIES, CURRENCY_LABEL, getCurrencyRates } from "@/lib/services/currency";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/commodities/fx — tỷ giá quy đổi cho máy tính tiền tệ trên trang hàng hóa.
 * USD→VND từ VietnamBiz (currency-interest-rate) khi khả dụng; cặp khác exchangerate-api.
 */
export async function GET() {
  try {
    const r = await getCurrencyRates();
    return ok(
      {
        base: "USD",
        currencies: CONVERTIBLE_CURRENCIES.map((c) => ({ code: c, label: CURRENCY_LABEL[c] })),
        rates: r.rates,
        usdVndVietnamBiz: r.usdVndVietnamBiz,
        source: r.source,
        timestamp: r.timestamp ? new Date(r.timestamp).toISOString() : null,
      },
      {
        source: r.source,
        sourceTimestampMs: r.timestamp,
        note: "Tỷ giá quy đổi (1 USD = X đơn vị). USD→VND từ VietnamBiz khi khả dụng; cặp còn lại từ exchangerate-api — cập nhật theo ngày.",
      },
    );
  } catch {
    return unavailable(
      "commodity-fx",
      "Chưa lấy được tỷ giá — nguồn (VietnamBiz / exchangerate-api) lỗi tạm thời; máy tính không dùng tỷ giá giả.",
    );
  }
}
