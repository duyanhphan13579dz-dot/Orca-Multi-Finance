import "server-only";
import { httpText } from "../http";
import { ProviderError } from "./binance";

/**
 * Commodity data — VietnamBiz DATA portal ONLY.
 * Source: https://data.vietnambiz.vn/goods (Next.js SSG __NEXT_DATA__).
 * All groups: hang_tieu_dung, kim_loai_phi_kim, hoa_chat,
 * vat_lieu_xay_dung, nang_luong, nhua_va_cao_su.
 */

export const VIETNAMBIZ = "vietnambiz-data";
export const VNB_GOODS_URL = "https://data.vietnambiz.vn/goods";

export interface RawCommodityQuote {
  source: string;
  price: number;
  change?: number | null;
  changePercent?: number | null;
  high?: number | null;
  low?: number | null;
  unit?: string | null;
  currency?: string | null;
  timestamp: number | null;
  url?: string | null;
  note?: string | null;
}

export type CommodityGroup =
  | "hang_tieu_dung"
  | "kim_loai_phi_kim"
  | "hoa_chat"
  | "vat_lieu_xay_dung"
  | "nang_luong"
  | "nhua_va_cao_su";

export const GROUP_LABELS: Record<CommodityGroup, { title: string; desc: string }> = {
  hang_tieu_dung: { title: "Hàng tiêu dùng", desc: "Heo · Cà phê · Gạo · Tiêu…" },
  kim_loai_phi_kim: { title: "Kim loại & phi kim", desc: "Vàng · Bạc · Đồng · Nhôm…" },
  hoa_chat: { title: "Hóa chất", desc: "Ure · Phân · Lưu huỳnh…" },
  vat_lieu_xay_dung: { title: "Vật liệu xây dựng", desc: "Thép · Xi măng · Đá…" },
  nang_luong: { title: "Năng lượng", desc: "WTI · Xăng · Than · LPG…" },
  nhua_va_cao_su: { title: "Nhựa & cao su", desc: "PVC · PP · PET · Cao su…" },
};

export interface CommodityDef {
  key: string;
  name: string;
  nameVi: string;
  group: CommodityGroup;
  symbol: string;
  unit: string;
  currency: string;
  vnImpact?: { sector: string; stocks: string[]; mechanism: string };
}

interface VnbItem {
  title: string;
  type: string;
  unit: string;
  value: number;
  value_d: number | null;
  value_w: number | null;
  value_m: number | null;
  value_y: number | null;
  time_update: string;
}

function slugKey(title: string, group: string): string {
  const base = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `${group.slice(0, 3)}-${base || "item"}`;
}

function symbolFromTitle(title: string): string {
  const s = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 12);
  return s || "GOODS";
}

function currencyFromUnit(unit: string): string {
  const u = unit.toLowerCase();
  if (u.includes("đồng") || u.includes("dong") || u.includes("nghìn")) return "VND";
  if (u.includes("cny") || u.includes("nhân dân")) return "CNY";
  if (u.includes("usd")) return "USD";
  if (u.includes("myr")) return "MYR";
  if (u.includes("yên") || u.includes("jpy") || u.includes("yen")) return "JPY";
  if (u.includes("eur")) return "EUR";
  return "—";
}

function normalizeUnitPrice(unit: string, value: number): { unit: string; price: number; currency: string } {
  const u = unit.trim();
  if (/nghìn\s*\/\s*lít/i.test(u)) {
    return { unit: "VND/lít", price: value * 1000, currency: "VND" };
  }
  const currency = currencyFromUnit(u);
  let unitOut = u;
  if (/^đồng\//i.test(u) || /^dong\//i.test(u)) unitOut = u.replace(/^đồng/i, "VND").replace(/^dong/i, "VND");
  return { unit: unitOut, price: value, currency };
}

function parseVnbDate(s: string): number | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const t = Date.parse(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T12:00:00+07:00`);
  return Number.isFinite(t) ? t : null;
}

function isGroup(t: string): t is CommodityGroup {
  return t in GROUP_LABELS;
}

export interface VnbGoodsSnapshot {
  items: Array<{
    def: CommodityDef;
    quote: RawCommodityQuote;
  }>;
  fetchedAt: number;
}

export async function fetchVietnambizGoods(): Promise<VnbGoodsSnapshot> {
  const res = await httpText(VNB_GOODS_URL, {
    provider: VIETNAMBIZ,
    timeoutMs: 25_000,
    retries: 1,
  });
  if (!res.ok || !res.text) {
    throw new ProviderError(`vietnambiz-data: ${res.error ?? "unreachable"}`, VIETNAMBIZ);
  }
  const m = res.text.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
  if (!m?.[1]) {
    throw new ProviderError("vietnambiz-data: __NEXT_DATA__ missing", VIETNAMBIZ);
  }
  let pageData: unknown;
  try {
    pageData = JSON.parse(m[1]);
  } catch {
    throw new ProviderError("vietnambiz-data: JSON parse failed", VIETNAMBIZ);
  }
  const groups = (pageData as { props?: { pageProps?: { data?: Record<string, VnbItem[]> } } })?.props
    ?.pageProps?.data;
  if (!groups || typeof groups !== "object") {
    throw new ProviderError("vietnambiz-data: empty pageProps.data", VIETNAMBIZ);
  }

  const items: VnbGoodsSnapshot["items"] = [];
  const usedSymbols = new Set<string>();

  for (const [type, list] of Object.entries(groups)) {
    if (!Array.isArray(list)) continue;
    const group: CommodityGroup = isGroup(type) ? type : "hang_tieu_dung";
    for (const raw of list) {
      if (!raw || typeof raw.title !== "string" || !Number.isFinite(Number(raw.value))) continue;
      const value = Number(raw.value);
      if (!(value > 0)) continue;
      const { unit, price, currency } = normalizeUnitPrice(String(raw.unit ?? ""), value);
      let symbol = symbolFromTitle(raw.title);
      if (usedSymbols.has(symbol)) {
        let i = 2;
        while (usedSymbols.has(`${symbol}${i}`)) i++;
        symbol = `${symbol}${i}`;
      }
      usedSymbols.add(symbol);
      const key = slugKey(raw.title, group);
      const ts = parseVnbDate(String(raw.time_update ?? ""));
      const changePercent =
        raw.value_d != null && Number.isFinite(Number(raw.value_d)) ? Number(raw.value_d) : null;

      const def: CommodityDef = {
        key,
        name: raw.title,
        nameVi: raw.title,
        group,
        symbol,
        unit,
        currency,
      };
      const quote: RawCommodityQuote = {
        source: "VietnamBiz Data",
        price,
        change: null,
        changePercent,
        unit,
        currency,
        timestamp: ts,
        url: VNB_GOODS_URL,
        note: raw.time_update ? `Cập nhật ${raw.time_update}` : null,
      };
      items.push({ def, quote });
    }
  }

  if (!items.length) {
    throw new ProviderError("vietnambiz-data: no items parsed", VIETNAMBIZ);
  }

  return { items, fetchedAt: Date.now() };
}

export const COMMODITY_CATALOG: CommodityDef[] = [];
