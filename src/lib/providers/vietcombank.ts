import "server-only";
import { httpJson } from "../http";
import { ProviderError } from "./binance";

/**
 * VIETCOMBANK PUBLIC EXCHANGE-RATE API — buy cash / buy transfer / sell
 * (VND per foreign-currency unit), cập nhật hằng ngày theo ngày làm việc.
 *
 * `GET https://www.vietcombank.com.vn/api/exchangerates?date=YYYY-MM-DD`
 * — KHÔNG cần key; `date` BẮT BUỘC (không date → 404 azurewebsites).
 * Verified live 2026-09-06: với date=2026-09-06 (Chủ nhật) API vẫn trả phiên
 * gần nhất với `UpdatedDate=2026-09-05T23:00:00+07:00` (USD cash 25,845 /
 * transfer 25,875 / sell 26,255). Cuối tuần/ngày lễ KHÔNG phải provider error:
 * dữ liệu là phiên giao dịch gần nhất — caller ghi nhãn freshness trung thực.
 */

export const VIETCOMBANK = "vietcombank-public";

export interface VcbCurrencyRates {
  code: string;
  name: string | null;
  /** Mua tiền mặt (VND) — null khi ngân hàng không công bố */
  cash: number | null;
  /** Mua chuyển khoản (VND) */
  transfer: number | null;
  /** Bán ra (VND) */
  sell: number | null;
}

export interface VcbFxResult {
  /** ngày dữ liệu (từ payload, có thể là ngày trước khi cuối tuần) */
  date: string | null;
  /** thời điểm cập nhật provider (epoch ms) — nguồn freshness */
  updatedAt: number | null;
  currencies: Map<string, VcbCurrencyRates>;
}

type VcbDataItem = {
  currencyName?: string;
  currencyCode?: string;
  cash?: string | number | null;
  transfer?: string | number | null;
  sell?: string | number | null;
};

type VcbPayload = {
  Date?: string;
  UpdatedDate?: string;
  Data?: VcbDataItem[];
};

function parseVnd(v: string | number | null | undefined): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Thuần túy — parse payload VCB thành bản đồ currency → 3 mức giá. */
export function parseVcbPayload(payload: unknown): VcbFxResult {
  const p = (payload ?? {}) as VcbPayload;
  const currencies = new Map<string, VcbCurrencyRates>();
  if (Array.isArray(p.Data)) {
    for (const item of p.Data) {
      const code = String(item?.currencyCode ?? "").trim().toUpperCase();
      if (!code) continue;
      currencies.set(code, {
        code,
        name: item?.currencyName ? String(item.currencyName).trim() : null,
        cash: parseVnd(item?.cash),
        transfer: parseVnd(item?.transfer),
        sell: parseVnd(item?.sell),
      });
    }
  }
  const updatedRaw = p.UpdatedDate ?? p.Date ?? null;
  const updatedAt = updatedRaw ? Date.parse(String(updatedRaw)) : null;
  return {
    date: p.Date ? String(p.Date).slice(0, 10) : null,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : null,
    currencies,
  };
}

/** Lấy tỷ giá ngân hàng (VND/1 đơn vị ngoại tệ) cho ngày hiện tại. */
export async function getVcbFxRates(): Promise<VcbFxResult> {
  const date = new Date().toISOString().slice(0, 10);
  const res = await httpJson<VcbPayload>(`https://www.vietcombank.com.vn/api/exchangerates?date=${date}`, {
    provider: VIETCOMBANK,
    timeoutMs: 8_000,
    retries: 1,
    headers: { Accept: "application/json" },
  });
  if (!res.ok || !res.data || !Array.isArray(res.data.Data) || res.data.Data.length === 0) {
    throw new ProviderError(`vietcombank: ${res.error ?? "unreachable / empty"}`, VIETCOMBANK);
  }
  const parsed = parseVcbPayload(res.data);
  if (parsed.currencies.size === 0) {
    throw new ProviderError("vietcombank: empty currencies payload", VIETCOMBANK);
  }
  return parsed;
}
