import "server-only";
import { httpText } from "../http";
import { ProviderError } from "./binance";

/**
 * Commodity data — VietnamBiz DATA portal ONLY.
 * Source: https://data.vietnambiz.vn/goods (Next.js SSG __NEXT_DATA__).
 * Optimized: indexOf extract (no full-body regex), single-pass parse, gzip-friendly fetch.
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
  let out = "";
  const lower = title.toLowerCase();
  for (let i = 0; i < lower.length && out.length < 48; i++) {
    const c = lower.charCodeAt(i);
    if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) out += lower[i];
    else if (out.length && out[out.length - 1] !== "-") out += "-";
  }
  while (out.endsWith("-")) out = out.slice(0, -1);
  if (!out) {
    out = title
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48);
  }
  return `${group.slice(0, 3)}-${out || "item"}`;
}

function symbolFromTitle(title: string): string {
  let s = "";
  const up = title.toUpperCase();
  for (let i = 0; i < up.length && s.length < 12; i++) {
    const c = up.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (c >= 48 && c <= 57)) s += up[i];
  }
  if (s) return s;
  return (
    title
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "")
      .slice(0, 12) || "GOODS"
  );
}

/**
 * Đồng bộ tiền tệ 1-1 với Vietnambiz (nguồn duy nhất https://data.vietnambiz.vn/goods).
 * Quan sát thực tế 08/09/2026:
 *  Đồng/kg | Đồng/tấn | Đồng/m3 | Đồng/m2 | Đồng/lít | Đồng/lượng | Đồng/viên | Đồng/cọc | Đồng/m → VND
 *  Nghìn/lít (xăng) → VND (quy về VND/lít, ×1000)
 *  CNY/tấn → CNY ; USD/tấn|USD/ounce|USD/pound|USD/thùng|USD/Mmbtu → USD
 *  MYR/tấn → MYR ; Yên/tấn → JPY ; EUR/... → EUR
 */
function currencyFromUnit(unit: string): string {
  const u = unit.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
  if (u.includes("dong") || u.includes("nghin") || u.includes("vnd")) return "VND";
  if (u.includes("cny")) return "CNY";
  if (u.includes("usd")) return "USD";
  if (u.includes("myr")) return "MYR";
  if (u.includes("yen") || u.includes("jpy")) return "JPY";
  if (u.includes("eur")) return "EUR";
  if (u.includes("gbp")) return "GBP";
  if (unit.toLowerCase().includes("yên")) return "JPY";
  return "—";
}

function normalizeUnitPrice(unit: string, value: number): { unit: string; price: number; currency: string } {
  const u = unit.trim();
  if (/nghìn\s*\/\s*lít/i.test(u)) {
    return { unit: "VND/lít", price: value * 1000, currency: "VND" };
  }
  const currency = currencyFromUnit(u);
  let unitOut = u;
  if (/^đồng\//i.test(u)) unitOut = u.replace(/^đồng/i, "VND");
  else if (/^dong\//i.test(u) || /^đong\//i.test(u)) unitOut = u.replace(/^đong/i, "VND").replace(/^dong/i, "VND");
  else if (/^yên\//i.test(u) || /^yen\//i.test(u)) unitOut = u.replace(/^yên/i, "JPY").replace(/^yen/i, "JPY").replace(/^Yên/i, "JPY");
  else if (/^nghìn\//i.test(u)) unitOut = u.replace(/^nghìn/i, "VND");
  if (currency === "VND" && /^đồng\b/i.test(unitOut)) unitOut = unitOut.replace(/^đồng/i, "VND");
  return { unit: unitOut, price: value, currency: currency === "—" && /đồng|dong|nghìn/i.test(u) ? "VND" : currency };
}

function parseVnbDate(s: string): number | null {
  if (!s || s.length < 8) return null;
  const p1 = s.indexOf("/");
  const p2 = s.indexOf("/", p1 + 1);
  if (p1 < 0 || p2 < 0) return null;
  const d = Number(s.slice(0, p1));
  const m = Number(s.slice(p1 + 1, p2));
  const y = Number(s.slice(p2 + 1, p2 + 5));
  if (!y || !m || !d) return null;
  const t = Date.UTC(y, m - 1, d, 5, 0, 0);
  return Number.isFinite(t) ? t : null;
}

function isGroup(t: string): t is CommodityGroup {
  return t in GROUP_LABELS;
}

/** Extract __NEXT_DATA__ JSON via indexOf — avoids RegExp on multi-MB HTML. */
function extractNextDataJson(html: string): string | null {
  const marker = 'id="__NEXT_DATA__"';
  let i = html.indexOf(marker);
  if (i < 0) i = html.indexOf("id='__NEXT_DATA__'");
  if (i < 0) return null;
  const gt = html.indexOf(">", i);
  if (gt < 0) return null;
  const end = html.indexOf("</script>", gt);
  if (end < 0) return null;
  return html.slice(gt + 1, end);
}

export interface VnbGoodsSnapshot {
  items: Array<{
    def: CommodityDef;
    quote: RawCommodityQuote;
  }>;
  fetchedAt: number;
  parseMs: number;
  downloadMs: number;
}

export async function fetchVietnambizGoods(): Promise<VnbGoodsSnapshot> {
  const t0 = Date.now();
  // Tăng cường: 2 retries, timeout 15s, header giống trình duyệt thực để tránh bị chặn
  const res = await httpText(VNB_GOODS_URL, {
    provider: VIETNAMBIZ,
    timeoutMs: 15_000,
    retries: 2,
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
      Referer: "https://data.vietnambiz.vn/",
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });
  const downloadMs = Date.now() - t0;
  if (!res.ok || !res.text) {
    throw new ProviderError(`vietnambiz-data: ${res.error ?? "unreachable"} (status ${res.status})`, VIETNAMBIZ);
  }

  const t1 = Date.now();
  // Thử nhiều cách trích xuất __NEXT_DATA__ để chống thay đổi cấu trúc HTML
  let jsonStr = extractNextDataJson(res.text);
  if (!jsonStr) {
    // Fallback 1: regex toàn cục tìm script id __NEXT_DATA__
    const re = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;
    const m = re.exec(res.text);
    if (m) jsonStr = m[1];
  }
  if (!jsonStr) {
    // Fallback 2: tìm window.__NEXT_DATA__ hoặc self.__next_f
    const re2 = /__NEXT_DATA__[^>]*>([\s\S]*?)<\/script>/i;
    const m2 = re2.exec(res.text);
    if (m2) jsonStr = m2[1];
  }
  if (!jsonStr) {
    throw new ProviderError("vietnambiz-data: __NEXT_DATA__ missing (HTML có thể bị chặn/WAF hoặc cấu trúc đổi)", VIETNAMBIZ);
  }
  jsonStr = jsonStr.trim();
  // Nếu HTML bị encode entities trong JSON, decode sơ
  if (jsonStr.startsWith("&")) {
    jsonStr = jsonStr.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  }

  let pageData: unknown;
  try {
    pageData = JSON.parse(jsonStr);
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

  for (const type of Object.keys(groups)) {
    const list = groups[type];
    if (!Array.isArray(list)) continue;
    const group: CommodityGroup = isGroup(type) ? type : "hang_tieu_dung";
    for (let i = 0; i < list.length; i++) {
      const raw = list[i];
      if (!raw || typeof raw.title !== "string") continue;
      const value = Number(raw.value);
      if (!Number.isFinite(value) || !(value > 0)) continue;

      const { unit, price, currency } = normalizeUnitPrice(String(raw.unit ?? ""), value);
      let symbol = symbolFromTitle(raw.title);
      if (usedSymbols.has(symbol)) {
        let n = 2;
        while (usedSymbols.has(symbol + n)) n++;
        symbol = symbol + n;
      }
      usedSymbols.add(symbol);

      const ts = parseVnbDate(String(raw.time_update ?? ""));
      const changePercent =
        raw.value_d != null && Number.isFinite(Number(raw.value_d)) ? Number(raw.value_d) : null;

      items.push({
        def: {
          key: slugKey(raw.title, group),
          name: raw.title,
          nameVi: raw.title,
          group,
          symbol,
          unit,
          currency,
        },
        quote: {
          source: "VietnamBiz Data",
          price,
          change: null,
          changePercent,
          unit,
          currency,
          timestamp: ts,
          url: VNB_GOODS_URL,
          note: raw.time_update ? `Cập nhật ${raw.time_update}` : null,
        },
      });
    }
  }

  if (!items.length) {
    throw new ProviderError("vietnambiz-data: no items parsed", VIETNAMBIZ);
  }

  return { items, fetchedAt: Date.now(), parseMs: Date.now() - t1, downloadMs };
}

export const COMMODITY_CATALOG: CommodityDef[] = [];
