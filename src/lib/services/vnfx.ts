import "server-only";
import { cached } from "../cache";
import { getVcbFxRates, VIETCOMBANK, type VcbFxResult } from "../providers/vietcombank";
import { getVnbRates, VN_DATA_SOURCE, type VnbRateRow } from "../providers/vietnambiz-data";

/**
 * VIETNAM FX DOMAIN — mô hình USD/VND riêng với 4 mức giá trung thực:
 *   reference   = Tỷ giá trung tâm SBV (VietnamBiz Data /currency-interest-rate, WiFeed)
 *   buyCash     = VCB "Mua tiền mặt" (Vietcombank public API, keyless)
 *   buyTransfer = VCB "Mua chuyển khoản"
 *   sell        = VCB "Bán ra" (fallback: VietnamBiz "Tỷ giá USD NHTM bán ra")
 *   freeSell    = VietnamBiz "Tỷ giá USD tự do bán ra"
 *
 * Nguồn ưu tiên: DIRECT public keyless, cập nhật theo ngày làm việc. Cuối tuần /
 * ngày lễ: Vietcombank trả phiên gần nhất (UpdatedDate) → KHÔNG coi là provider
 * error — nhãn freshness + note giải thích. Mức nào nguồn không công bố → null
 * (không suy diễn giữa buy/sell).
 */

export interface VnFxPoint {
  rate: number | null;
  indicator: string | null;
  source: string;
  period: string | null;
}

export interface VnFxModel {
  pair: "USDVND";
  base: "USD";
  quote: "VND";
  reference: VnFxPoint | null;
  buyCash: VnFxPoint | null;
  buyTransfer: VnFxPoint | null;
  sell: VnFxPoint | null;
  freeSell: VnFxPoint | null;
  /** giá dùng cho row thị trường: sell → transfer → reference (thứ tự ưu tiên) */
  rate: number | null;
  updatedAt: number | null;
  source: string;
  note: string;
}

const VNB_REFERENCE = "Tỷ giá trung tâm";
const VNB_BANK_SELL = "Tỷ giá USD NHTM bán ra";
const VNB_FREE_SELL = "Tỷ giá USD tự do bán ra";

export const VCB_SOURCE = "Vietcombank (public API)";

function vnbPoint(rows: VnbRateRow[], key: string): VnFxPoint | null {
  const hit = rows.find((r) => r.indicator.toLowerCase().includes(key.toLowerCase()));
  if (!hit || hit.current == null || !Number.isFinite(hit.current) || hit.current <= 0) return null;
  return { rate: hit.current, indicator: hit.indicator, source: `${VN_DATA_SOURCE} (${key})`, period: hit.period || null };
}

/** Parse nhãn kỳ công bố của VietnamBiz ("Ngày 04/09/2026") → epoch ms (00:00 UTC). */
export function parseVnbPeriod(period: string | null | undefined): number | null {
  if (!period) return null;
  const m = /Ngày\s+(\d{2})\/(\d{2})\/(\d{4})/i.exec(period.trim());
  if (!m) return null;
  const ts = Date.parse(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`);
  return Number.isFinite(ts) ? ts : null;
}

/** Thuần túy — merge VCB + VNB thành model đầy đủ (test được). */
export function buildVnFxModel(vcb: VcbFxResult | null, vnbRows: VnbRateRow[]): VnFxModel {
  const usd = vcb?.currencies.get("USD") ?? null;
  const vcbTs = vcb?.updatedAt ?? null;
  const ref = vnbPoint(vnbRows, VNB_REFERENCE);
  const bankSell = vnbPoint(vnbRows, VNB_BANK_SELL);
  const freeSell = vnbPoint(vnbRows, VNB_FREE_SELL);

  const buyCash: VnFxPoint | null = usd?.cash != null ? { rate: usd.cash, indicator: "Vietcombank mua tiền mặt", source: VCB_SOURCE, period: vcb?.date ?? null } : null;
  const buyTransfer: VnFxPoint | null = usd?.transfer != null ? { rate: usd.transfer, indicator: "Vietcombank mua chuyển khoản", source: VCB_SOURCE, period: vcb?.date ?? null } : null;
  const sell: VnFxPoint | null = usd?.sell != null ? { rate: usd.sell, indicator: "Vietcombank bán ra", source: VCB_SOURCE, period: vcb?.date ?? null } : bankSell;

  const sources: string[] = [];
  if (vcb) sources.push(VCB_SOURCE);
  if (ref || bankSell || freeSell) sources.push(VN_DATA_SOURCE);

  const rate = sell?.rate ?? buyTransfer?.rate ?? ref?.rate ?? buyCash?.rate ?? null;

  let note = "USD/VND là tỷ giá ngân hàng (Vietcombank công khai) + tỷ giá tham chiếu SBV from VietnamBiz Data (WiFeed). Cập nhật theo ngày làm việc; khi thị trường VN đóng cửa (cuối tuần/ngày lễ) giữ phiên gần nhất — không phải provider error.";
  if (!vcb && bankSell) note = "Vietcombank API chưa khả dụng — dùng tỷ giá tham chiếu từ VietnamBiz Data (WiFeed): NHTM bán ra + trung tâm SBV. Mức mua (cash/transfer) nguồn không công bố → UNAVAILABLE.";
  if (!vcb && !ref && !bankSell && !freeSell && !buyCash) note = "Không có nguồn tỷ giá VN nào khả dụng (Vietcombank + VietnamBiz) — không suy diễn.";

  return {
    pair: "USDVND",
    base: "USD",
    quote: "VND",
    reference: ref,
    buyCash,
    buyTransfer,
    sell,
    freeSell,
    rate,
    updatedAt: vcbTs ?? (ref?.period ? parseVnbPeriod(ref?.period ?? null) : null) ?? (bankSell?.period ? parseVnbPeriod(bankSell.period) : null),
    source: sources.length ? sources.join(" + ") : "unavailable",
    note,
  };
}

/** Lấy mô hình USD/VND (cache 30 phút + stale 48h — dữ liệu đổi theo ngày). */
export async function getVnFx(): Promise<VnFxModel> {
  const res = await cached<VnFxModel>("vnfx:model", {
    ttlMs: 30 * 60_000,
    staleMs: 48 * 3_600_000,
    producer: async () => {
      let vcb: VcbFxResult | null = null;
      try {
        vcb = await getVcbFxRates();
      } catch {
        /* nguồn lỗi → fallback VNB */
      }
      let vnbRows: VnbRateRow[] = [];
      try {
        vnbRows = (await getVnbRates()).rows;
      } catch {
        /* portal lỗi → chỉ còn VCB */
      }
      return buildVnFxModel(vcb, vnbRows);
    },
  });
  return res.value;
}

export { VIETCOMBANK };
