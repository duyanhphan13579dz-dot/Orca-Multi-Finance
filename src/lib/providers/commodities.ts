import "server-only";
import { httpJson, httpText } from "../http";
import { ProviderError } from "./binance";

/**
 * Commodity data — VietnamBiz DATA portal ONLY.
 * Source: https://data.vietnambiz.vn/goods
 *
 * Fetch strategy (resilience):
 *  1. Next.js data JSON  /_next/data/{buildId}/goods.json  (~12KB, preferred)
 *  2. HTML page __NEXT_DATA__ fallback (gzip, longer timeout)
 * buildId is cached in-process and refreshed when JSON returns 404.
 */

export const VIETNAMBIZ = "vietnambiz-data";
export const VNB_GOODS_URL = "https://data.vietnambiz.vn/goods";
export const VNB_DATA_ORIGIN = "https://data.vietnambiz.vn";

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

function currencyFromUnit(unit: string): string {
  const u = unit.toLowerCase();
  if (u.includes("đồng") || u.includes("dong") || u.includes("nghìn")) return "VND";
  if (u.includes("cny")) return "CNY";
  if (u.includes("usd")) return "USD";
  if (u.includes("myr")) return "MYR";
  if (u.includes("yên") || u.includes("yen") || u.includes("jpy")) return "JPY";
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

function extractBuildId(html: string): string | null {
  const m = html.match(/"buildId"\s*:\s*"([^"]+)"/);
  return m?.[1] ?? null;
}

export interface VnbGoodsSnapshot {
  items: Array<{ def: CommodityDef; quote: RawCommodityQuote }>;
  fetchedAt: number;
  parseMs: number;
  downloadMs: number;
  path?: string;
}

let cachedBuildId: { id: string; at: number } | null = null;
const BUILD_ID_TTL_MS = 6 * 60 * 60_000;

function rememberBuildId(id: string) {
  cachedBuildId = { id, at: Date.now() };
}

function groupsFromUnknown(pageData: unknown): Record<string, VnbItem[]> | null {
  const a = (pageData as { props?: { pageProps?: { data?: Record<string, VnbItem[]> } } })?.props?.pageProps?.data;
  if (a && typeof a === "object") return a;
  const b = (pageData as { pageProps?: { data?: Record<string, VnbItem[]> } })?.pageProps?.data;
  if (b && typeof b === "object") return b;
  if (pageData && typeof pageData === "object" && !Array.isArray(pageData)) {
    const keys = Object.keys(pageData as object);
    if (keys.some((k) => isGroup(k))) return pageData as Record<string, VnbItem[]>;
  }
  return null;
}

function parseGroups(groups: Record<string, VnbItem[]>): VnbGoodsSnapshot["items"] {
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
        def: { key: slugKey(raw.title, group), name: raw.title, nameVi: raw.title, group, symbol, unit, currency },
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
  return items;
}

const BROWSER_HEADERS: Record<string, string> = {
  Accept: "text/html,application/xhtml+xml,application/json",
  "Accept-Encoding": "gzip, deflate, br",
  "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Referer: "https://vietnambiz.vn/",
  "Cache-Control": "no-cache",
};

async function discoverBuildId(): Promise<string | null> {
  if (cachedBuildId && Date.now() - cachedBuildId.at < BUILD_ID_TTL_MS) return cachedBuildId.id;
  const res = await httpText(VNB_GOODS_URL, {
    provider: VIETNAMBIZ,
    timeoutMs: 18_000,
    retries: 2,
    headers: BROWSER_HEADERS,
  });
  if (!res.ok || !res.text) return null;
  const id = extractBuildId(res.text);
  if (id) rememberBuildId(id);
  return id;
}

async function fetchViaNextData(buildId: string): Promise<{ groups: Record<string, VnbItem[]>; downloadMs: number } | null> {
  const t0 = Date.now();
  const url = `${VNB_DATA_ORIGIN}/_next/data/${encodeURIComponent(buildId)}/goods.json`;
  const res = await httpJson<{ pageProps?: { data?: Record<string, VnbItem[]> } }>(url, {
    provider: VIETNAMBIZ,
    timeoutMs: 12_000,
    retries: 2,
    headers: { ...BROWSER_HEADERS, Accept: "application/json" },
  });
  const downloadMs = Date.now() - t0;
  if (!res.ok || !res.data) {
    if (res.status === 404) cachedBuildId = null;
    return null;
  }
  const groups = groupsFromUnknown(res.data);
  if (!groups) return null;
  return { groups, downloadMs };
}

async function fetchViaHtml(): Promise<{ groups: Record<string, VnbItem[]>; downloadMs: number; buildId: string | null } | null> {
  const t0 = Date.now();
  const res = await httpText(VNB_GOODS_URL, {
    provider: VIETNAMBIZ,
    timeoutMs: 22_000,
    retries: 2,
    headers: BROWSER_HEADERS,
  });
  const downloadMs = Date.now() - t0;
  if (!res.ok || !res.text) return null;
  const buildId = extractBuildId(res.text);
  if (buildId) rememberBuildId(buildId);
  const jsonStr = extractNextDataJson(res.text);
  if (!jsonStr) return null;
  let pageData: unknown;
  try {
    pageData = JSON.parse(jsonStr);
  } catch {
    return null;
  }
  const groups = groupsFromUnknown(pageData);
  if (!groups) return null;
  return { groups, downloadMs, buildId };
}

export async function fetchVietnambizGoods(): Promise<VnbGoodsSnapshot> {
  const tParse0 = Date.now();
  let groups: Record<string, VnbItem[]> | null = null;
  let downloadMs = 0;
  let path = "none";

  try {
    const buildId = await discoverBuildId();
    if (buildId) {
      const via = await fetchViaNextData(buildId);
      if (via?.groups) {
        groups = via.groups;
        downloadMs = via.downloadMs;
        path = "next-data";
      }
    }
  } catch {
    /* fall through */
  }

  if (!groups) {
    try {
      const via = await fetchViaHtml();
      if (via?.groups) {
        groups = via.groups;
        downloadMs = via.downloadMs;
        path = "html";
        if (via.buildId) void fetchViaNextData(via.buildId).catch(() => null);
      }
    } catch {
      /* fall through */
    }
  }

  if (!groups && cachedBuildId) {
    try {
      const via = await fetchViaNextData(cachedBuildId.id);
      if (via?.groups) {
        groups = via.groups;
        downloadMs = via.downloadMs;
        path = "next-data-retry";
      }
    } catch {
      /* */
    }
  }

  if (!groups) {
    throw new ProviderError(
      "vietnambiz-data: unreachable (next-data + html failed) — data.vietnambiz.vn/goods",
      VIETNAMBIZ,
    );
  }

  const t1 = Date.now();
  const items = parseGroups(groups);
  if (!items.length) throw new ProviderError("vietnambiz-data: no items parsed", VIETNAMBIZ);

  return {
    items,
    fetchedAt: Date.now(),
    parseMs: Date.now() - t1,
    downloadMs: downloadMs || Date.now() - tParse0,
    path,
  };
}

export const COMMODITY_CATALOG: CommodityDef[] = [];
