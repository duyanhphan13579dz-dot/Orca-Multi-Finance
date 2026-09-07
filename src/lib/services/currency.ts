import "server-only";
import { cached } from "../cache";
import { getErApiLatest, type FxLatest } from "../providers/forex";
import { getEconomicData } from "./economy";

/**
 * MÁY TÍNH QUY ĐỔI TIỀN TỆ (commodities).
 *
 * Tỷ giá THẬT, không hard-code:
 *  - USD → VND: ưu tiên VietnamBiz Data /currency-interest-rate
 *    ("Tỷ giá USD NHTM bán ra", fallback "Tỷ giá trung tâm").
 *  - Các cặp còn lại (CNY/JPY/MYR/EUR/GBP… tính từ USD): exchangerate-api open.
 * Mọi payload ghi rõ nguồn + timestamp; không số giả.
 */

export const CONVERTIBLE_CURRENCIES = ["VND", "USD", "CNY", "JPY", "MYR", "EUR", "GBP"] as const;
export type ConvertibleCurrency = (typeof CONVERTIBLE_CURRENCIES)[number];

export const CURRENCY_LABEL: Record<ConvertibleCurrency, string> = {
  VND: "Việt Nam Đồng",
  USD: "Đô la Mỹ",
  CNY: "Nhân dân tệ",
  JPY: "Yên Nhật",
  MYR: "Ringgit Malaysia",
  EUR: "Euro",
  GBP: "Bảng Anh",
};

export interface CurrencyRates {
  /** rates[currency] = số đơn vị currency đổi được cho 1 USD */
  rates: Record<ConvertibleCurrency, number>;
  /** USD → VND từ portal VietnamBiz (chính thức) — null khi trang lỗi */
  usdVndVietnamBiz: { rate: number; indicator: string; period: string | null } | null;
  source: string;
  /** ER-API provider timestamp (millis) */
  timestamp: number | null;
}

const VND_USD_INDICATORS = [
  "Tỷ giá USD NHTM bán ra",
  "USD NHTM bán ra",
  "Tỷ giá trung tâm",
  "Tỷ giá USD tự do bán",
];

function pickVnbUsdVnd(
  rows: { name: string; period: string; current: { value: number | null } }[],
): { rate: number; indicator: string; period: string | null } | null {
  for (const key of VND_USD_INDICATORS) {
    const hit = rows.find((r) => r.name.toLowerCase().includes(key.toLowerCase()));
    if (hit && hit.current.value != null && Number.isFinite(hit.current.value) && hit.current.value > 0) {
      return { rate: hit.current.value, indicator: hit.name, period: hit.period || null };
    }
  }
  return null;
}

async function loadErApiRates(): Promise<FxLatest> {
  return cached<FxLatest>("forex:er-latest", {
    ttlMs: 10 * 60_000,
    staleMs: 26 * 3_600_000,
    producer: () => getErApiLatest(),
  }).then((r) => r.value);
}

export async function getCurrencyRates(): Promise<CurrencyRates> {
  const er = await loadErApiRates();
  const base: Partial<Record<ConvertibleCurrency, number>> = {
    USD: 1,
    VND: er.rates.VND,
    CNY: er.rates.CNY,
    JPY: er.rates.JPY,
    MYR: er.rates.MYR,
    EUR: er.rates.EUR,
    GBP: er.rates.GBP,
  };

  let usdVndVietnamBiz: CurrencyRates["usdVndVietnamBiz"] = null;
  try {
    const econ = await getEconomicData("currency-interest-rate");
    if (econ?.data?.rows?.length) {
      const vnbUsdVnd = pickVnbUsdVnd(econ.data.rows);
      if (vnbUsdVnd) {
        base.VND = vnbUsdVnd.rate;
        usdVndVietnamBiz = vnbUsdVnd;
      }
    }
  } catch {
    /* portal lỗi → dùng ER-API VND */
  }

  const rates = {} as Record<ConvertibleCurrency, number>;
  for (const c of CONVERTIBLE_CURRENCIES) {
    const v = base[c];
    if (v == null || !Number.isFinite(v) || v <= 0) {
      rates[c] = c === "USD" ? 1 : NaN;
    } else {
      rates[c] = v;
    }
  }
  return {
    rates,
    usdVndVietnamBiz,
    source: usdVndVietnamBiz
      ? "VietnamBiz Data (currency-interest-rate) + exchangerate-api (open)"
      : "exchangerate-api (open)",
    timestamp: er.ts,
  };
}

/** amount từ from → to dựa trên rates gốc USD (rates[USD] == 1). */
export function convertAmount(
  amount: number,
  from: ConvertibleCurrency,
  to: ConvertibleCurrency,
  rates: Record<ConvertibleCurrency, number>,
): number | null {
  if (!Number.isFinite(amount) || amount < 0) return null;
  const rFrom = rates[from];
  const rTo = rates[to];
  if (rFrom == null || rTo == null || !Number.isFinite(rFrom) || !Number.isFinite(rTo) || rFrom <= 0 || rTo <= 0) return null;
  return (amount * rTo) / rFrom;
}

/** Đổi giá commodity (price + currency gốc) sang displayCurrency. */
export function convertPrice(
  price: number,
  fromCurrency: string,
  toCurrency: ConvertibleCurrency,
  rates: Record<ConvertibleCurrency, number>,
): number | null {
  const from = fromCurrency.toUpperCase();
  if (!CONVERTIBLE_CURRENCIES.includes(from as ConvertibleCurrency)) return null;
  return convertAmount(price, from as ConvertibleCurrency, toCurrency, rates);
}
