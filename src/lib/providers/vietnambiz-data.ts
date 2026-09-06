import "server-only";
import { env } from "../env";
import { cached } from "../cache";
import { httpText } from "../http";
import { ProviderError } from "./binance";
import type { RawCommodityQuote } from "./commodities";

/**
 * VietnamBiz DATA PORTAL (data.vietnambiz.vn) — WiFeed/WiGroup tables.
 * URL do user cung cấp 2026-09-06; verified live: /goods có BẢNG GIÁ ĐỦ
 * (kể cả Nhôm/Kẽm Trung Quốc — 2 mục trước đây không nguồn nào có), /macro-economic
 * (GDP/CPI/PMI/FDI…), /currency-interest-rate (M2/tín dụng/tỷ giá/lãi suất NH).
 * Trang là SSR HTML table (không có JSON API — đã probe /api/goods, /goods.json → 404),
 * nên parser hoạt động trên <tr>/<td> thật, không đoán.
 * Ghi chú bản quyền từ trang: "Dữ liệu thuộc bản quyền CTCP WiGroup" — hiển thị
 * nguồn đầy đủ "VietnamBiz Data (WiFeed)" + url gốc trong mọi payload.
 */

export const VN_DATA_PROVIDER = "vietnambiz-data";
export const VN_DATA_SOURCE = "VietnamBiz Data (WiFeed)";

const UA = "Mozilla/5.0 (compatible; OrcaFinance/1.0; +https://github.com)";

/* ------------------------------ HTML helpers ------------------------------ */

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

/**
 * Xóa các khối scaffolding của trang (ANTD cssinjs SSR nhúng cả stylesheet vào
 * HTML/ô bảng — nếu chỉ xóa thẻ thì NỘI DUNG CSS vẫn lọt vào cell).
 */
function stripHtmlScaffolding(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, " ");
}

/** Quét nốt CSS rule còn sót (`.css-x19ppn{…}`, `where(…)`, `@media…`). */
function stripCssText(s: string): string {
  return s
    .replace(/\.css-[a-zA-Z0-9_\\-]+\s*\{[^}]*\}/g, " ")
    .replace(/where\([^)]*\)/gi, " ")
    .replace(/@media[^{]*\{[\s\S]*?\}\s*\}/g, " ")
    .replace(/[a-zA-Z0-9_.@#:\-\[\]'"]+\s*\{[^}]*\}/g, " ")
    .replace(/[\s,;{}:]+$/g, " ")
    .trim();
}

function cellText(cell: string): string {
  // giữ ranh giới <br> (name/unit) — chỉ collapse whitespace trong từng dòng
  return stripCssText(
    decodeEntities(stripHtmlScaffolding(cell))
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .split("\n")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .join("\n")
    .trim();
}

const isCssJunk = (s: string) => /\.css-|^\{|@media|where\(|ant-typography|font-weight:/.test(s);

/** cell đã cellText() nhưng vẫn lẫn CSS dạng text → trả về "" (không hiện rác). */
const cleanCell = (s: string | null | undefined): string => {
  const t = (s ?? "").trim();
  return isCssJunk(t) ? "" : t;
};

/** Header tokens nhận diện bảng dữ liệu thật (loại bảng dump CSS). */
const GOODS_HEADERS = ["Mặt hàng", "Giá", "% Ngày", "Ngày cập nhật"];
const MACRO_HEADERS = ["Chỉ tiêu", "Kỳ công bố", "Kỳ hiện tại", "Kỳ trước"];
const RATES_HEADERS = ["Chỉ tiêu", "Kỳ công bố", "Kỳ hiện tại", "Kỳ trước"];

function headerMatches(row: string[], tokens: string[]): boolean {
  const union = row.join(" ").toLowerCase();
  const hit = tokens.filter((t) => union.includes(t.toLowerCase())).length;
  return hit >= 2;
}

/**
 * Tách rows từ các BẢNG THẬT (theo header token). Loại bỏ scaffolding + các
 * bảng chứa CSS dump (bảng đầu tiên của trang SSR có thể là cssinjs critical CSS).
 */
export function extractTableRows(html: string, expectedHeaders: string[] = GOODS_HEADERS): string[][] {
  const out: string[][] = [];
  const htmlNoScope = stripHtmlScaffolding(html);
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tm: RegExpExecArray | null;
  while ((tm = tableRe.exec(htmlNoScope))) {
    const rows: string[][] = [];
    const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let m: RegExpExecArray | null;
    while ((m = trRe.exec(tm[1]))) {
      const tds: string[] = [];
      const tdRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let c: RegExpExecArray | null;
      while ((c = tdRe.exec(m[1]))) tds.push(cellText(c[1]));
      if (tds.length) rows.push(tds);
    }
    if (!rows.length) continue;
    const first = rows[0];
    // Chỉ giữ bảng có header khớp dữ liệu thật; bảng CSS (cột đầu là khối
    // `.css-…`) hoặc bảng khác bị loại.
    if (headerMatches(first, expectedHeaders) && !first.some((c) => isCssJunk(c))) {
      out.push(...rows.slice(1));
    }
  }
  return out;
}

/* ------------------------------ numeric/date ------------------------------ */

/** "57,833" → 57833 · "4,442.4" → 4442.4 · "718.89" → 718.89 · "25,605" → 25605 · "--" → null */
export function parseVnbNum(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = s.replace(/\s/g, "").replace(/%$/i, "");
  if (!t || t === "--" || t === "-" || t === "–" || /^[-–]$/.test(t)) return null;
  if (!/^[+-]?[\d.,]+$/.test(t)) return null;
  const neg = /^-/.test(t);
  const body = t.replace(/^[+-]/, "");
  const hasComma = body.includes(",");
  const hasDot = body.includes(".");
  let n: number;
  if (hasComma && hasDot) n = Number(body.replace(/,/g, "")); // comma = thousands, dot = decimal
  else if (hasComma) n = Number(body.replace(/,/g, "")); // thousands (verified: no decimal-comma values in this dataset)
  else n = Number(body);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/** "04/09/2026" → midnight +07:00; null when absent. */
export function parseVnbDate(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const ts = Date.parse(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T00:00:00+07:00`);
  return Number.isFinite(ts) ? ts : null;
}

/* --------------------------------- Goods ---------------------------------- */

export interface VnbGoodsRow {
  name: string;
  unit: string;
  price: number | null;
  pctDay: number | null;
  pctMonth: number | null;
  pctYear: number | null;
  date: string | null;
  dateTs: number | null;
}

/** Goods table: cell0 = "Name" (with <br> unit), price, %Ngày, %Tháng, %Năm, Ngày cập nhật. */
export function parseVnbGoodsRows(html: string): VnbGoodsRow[] {
  const out: VnbGoodsRow[] = [];
  for (const cells of extractTableRows(html, GOODS_HEADERS)) {
    if (cells.length < 6) continue;
    const [nameUnit, priceRaw, dRaw, mRaw, yRaw, dateRaw] = cells;
    const parts = nameUnit.split("\n");
    const name = cleanCell(decodeEntities(parts[0]));
    const unit = cleanCell(parts.length > 1 ? decodeEntities(parts.slice(1).join(" ")) : "");
    if (!name || /^(Mặt hàng|Chỉ tiêu)$/i.test(name)) continue; // CSS dump / header row
    const price = parseVnbNum(priceRaw);
    if (price == null) continue; // "--" hoặc header → bỏ
    // nếu cell giá vẫn còn lẫn CSS thì coi như không hợp lệ
    if (isCssJunk(`${priceRaw} ${dRaw} ${mRaw} ${yRaw} ${dateRaw}`)) continue;
    out.push({
      name,
      unit,
      price,
      pctDay: parseVnbNum(dRaw),
      pctMonth: parseVnbNum(mRaw),
      pctYear: parseVnbNum(yRaw),
      date: cleanCell(dateRaw) || null,
      dateTs: parseVnbDate(dateRaw),
    });
  }
  return out;
}

/**
 * Mapping WiFeed row → catalog key. Chỉ giữ các hàng KHỚP NGHĨA + ĐƠN VỊ xác định:
 * không quy đổi tiền tệ (CNY→USD v.v.) vì bịa — hàng nào đơn vị khác catalog thì
 * giữ đơn vị NGUỒN ở mức row (unit/currency từ quote), def.unit là canonical.
 * scale: 1000 = WiFeed "147,600" nghìn đồng/lượng → 147,600,000 VNĐ (SJC);
 * 1/1000 = "91,500" đồng/kg → 91.5 nghìn đồng/kg (đơn vị catalog tôm).
 */
interface VnbGoodsMap {
  rx: RegExp;
  key: string;
  scale?: number;
  unit?: string;
  currency?: string;
}

export const VNB_GOODS_MAP: VnbGoodsMap[] = [
  // Precious metals (USD/ounce; VN gold)
  { rx: /^Giá vàng trong nước$/, key: "sjc-gold", scale: 1000, unit: "VNĐ/Lượng", currency: "VND" },
  { rx: /^Giá vàng$/, key: "gold", unit: "USD/oz", currency: "USD" },
  { rx: /^Giá bạc$/, key: "silver", unit: "USD/oz", currency: "USD" },
  { rx: /^Giá đồng$/, key: "copper", unit: "USD/lb", currency: "USD" }, // WiFeed "USD/pound" ≡ USD/lb
  // Industrial (China CNY/tấn)
  { rx: /^Quặng sắt Trung Quốc$/, key: "iron-ore", unit: "CNY/T", currency: "CNY" },
  { rx: /^Kẽm Trung Quốc$/, key: "zinc", unit: "CNY/T", currency: "CNY" },
  { rx: /^Nhôm Trung Quốc$/, key: "aluminum", unit: "CNY/T", currency: "CNY" },
  { rx: /^Nikken Trung Quốc$/, key: "nickel", unit: "CNY/T", currency: "CNY" }, // WiFeed label cho nickel TQ
  { rx: /^HRC Trung Quốc$/, key: "steel", unit: "CNY/T", currency: "CNY" },
  // Fertilizer / energy
  { rx: /^Ure Trung Đông$/, key: "urea", unit: "USD/T", currency: "USD" },
  { rx: /^Than cốc Trung Quốc$/, key: "coal", unit: "CNY/T", currency: "CNY" },
  { rx: /^Dầu WTI$/, key: "wti", unit: "USD/bbl", currency: "USD" },
  { rx: /^Khí thiên nhiên$/, key: "natgas", unit: "USD/MMBtu", currency: "USD" },
  // VN agriculture / energy
  { rx: /^Giá heo hơi trong nước$/, key: "pig-vn", unit: "VNĐ/kg", currency: "VND" },
  { rx: /^Tôm thẻ$/, key: "shrimp-vn", scale: 1 / 1000, unit: "Nghìn đồng/kg", currency: "VND" },
  { rx: /^Xăng RON 95-V$/, key: "gasoline-95", unit: "Nghìn đồng/lít", currency: "VND" },
  { rx: /^Xăng sinh học E5 RON 92-II$/, key: "gasoline-92", unit: "Nghìn đồng/lít", currency: "VND" },
  { rx: /^Xăng Diezen$/, key: "diesel", unit: "Nghìn đồng/lít", currency: "VND" },
];

export const VNB_GOODS_KEYS: ReadonlySet<string> = new Set(VNB_GOODS_MAP.map((m) => m.key));

export function matchVnbGoods(name: string): VnbGoodsMap | null {
  for (const m of VNB_GOODS_MAP) if (m.rx.test(name)) return m;
  return null;
}

/** Map parsed WiFeed rows → quotes theo catalog key (mỗi key lấy hàng ĐẦU TIÊN khớp). */
export function mapVnbGoodsRows(rows: VnbGoodsRow[]): Map<string, RawCommodityQuote> {
  const out = new Map<string, RawCommodityQuote>();
  for (const row of rows) {
    const m = matchVnbGoods(row.name);
    if (!m || out.has(m.key)) continue;
    const price = row.price == null ? null : row.price * (m.scale ?? 1);
    if (price == null || price <= 0) continue;
    out.set(m.key, {
      source: VN_DATA_SOURCE,
      price,
      change: null,
      changePercent: row.pctDay,
      unit: m.unit ?? row.unit,
      currency: m.currency ?? "USD",
      timestamp: row.dateTs,
      url: `${env.vietnambizDataBaseUrl.replace(/\/$/, "")}/goods`,
    });
  }
  return out;
}

export async function getVnbDatasetText(dataset: "goods" | "macro-economic" | "currency-interest-rate"): Promise<string> {
  const base = env.vietnambizDataBaseUrl.replace(/\/$/, "");
  const url = `${base}/${dataset}`;
  const res = await cached(`vnb-data:${dataset}`, {
    // goods/rates cập nhật theo ngày; TTL theo snapshot (3s default, user-mandated)
    // để UI 3s luôn query lại portal — 1 request batch cho TOÀN BỘ mặt hàng.
    ttlMs: env.commoditySnapshotTtlMs,
    staleMs: 24 * 3_600_000,
    producer: async () => {
      const r = await httpText(url, {
        provider: VN_DATA_PROVIDER,
        timeoutMs: 9_000,
        retries: 1,
        headers: { "User-Agent": UA, Accept: "text/html" },
      });
      if (!r.ok || !r.text) throw new ProviderError(`vietnambiz-data: ${r.error ?? "unreachable"} (${url})`, VN_DATA_PROVIDER);
      return r.text;
    },
  });
  return res.value;
}

export async function getVnbGoodsQuotes(): Promise<Map<string, RawCommodityQuote>> {
  const html = await getVnbDatasetText("goods");
  const rows = parseVnbGoodsRows(html);
  const mapped = mapVnbGoodsRows(rows);
  if (mapped.size === 0) throw new ProviderError("vietnambiz-data: goods page parse failed (structure changed?)", VN_DATA_PROVIDER);
  return mapped;
}

/** Raw snapshot (tất cả hàng WiFeed) + mapped quotes — cho API diagnostics. */
export async function getVnbGoodsSnapshot(): Promise<{ rows: VnbGoodsRow[]; mapped: Record<string, RawCommodityQuote> }> {
  const html = await getVnbDatasetText("goods");
  const rows = parseVnbGoodsRows(html);
  const mapped: Record<string, RawCommodityQuote> = {};
  for (const [k, q] of mapVnbGoodsRows(rows)) mapped[k] = q;
  return { rows, mapped };
}

/* ------------------------- Macro / currency & rates ------------------------ */

export interface VnbMacroRow {
  indicator: string;
  period: string;
  current: number | null;
  currentRaw: string | null;
  previous: number | null;
  previousRaw: string | null;
  nextRelease: string | null;
}

/** Macro: Chỉ tiêu | Kỳ công bố | Kỳ hiện tại | Kỳ trước | Ngày công bố tiếp theo */
export function parseVnbMacroRows(html: string): VnbMacroRow[] {
  const out: VnbMacroRow[] = [];
  for (const cells of extractTableRows(html, MACRO_HEADERS)) {
    if (cells.length < 5) continue;
    const [indicator, period, cur, prev, next] = cells;
    if (!indicator || isCssJunk(indicator) || /^Chỉ tiêu$/i.test(indicator.trim()) || /kỳ hiện tại/i.test(indicator)) continue;
    out.push({
      indicator: indicator.trim(),
      period: cleanCell(period),
      current: parseVnbNum(cur),
      currentRaw: cleanCell(cur) || null,
      previous: parseVnbNum(prev),
      previousRaw: cleanCell(prev) || null,
      nextRelease: cleanCell(next) || null,
    });
  }
  return out;
}

export interface VnbRateRow {
  indicator: string;
  period: string;
  current: number | null;
  currentRaw: string | null;
  previous: number | null;
  previousRaw: string | null;
}

/** Rates: Chỉ tiêu | Kỳ công bố | Kỳ hiện tại | Kỳ trước */
export function parseVnbRatesRows(html: string): VnbRateRow[] {
  const out: VnbRateRow[] = [];
  for (const cells of extractTableRows(html, RATES_HEADERS)) {
    if (cells.length < 4) continue;
    const [indicator, period, cur, prev] = cells;
    if (!indicator || isCssJunk(indicator) || /^Chỉ tiêu$/i.test(indicator.trim()) || /kỳ hiện tại/i.test(indicator)) continue;
    out.push({
      indicator: indicator.trim(),
      period: cleanCell(period),
      current: parseVnbNum(cur),
      currentRaw: cleanCell(cur) || null,
      previous: parseVnbNum(prev),
      previousRaw: cleanCell(prev) || null,
    });
  }
  return out;
}

export async function getVnbMacro(): Promise<{ rows: VnbMacroRow[]; url: string }> {
  const html = await getVnbDatasetText("macro-economic");
  return { rows: parseVnbMacroRows(html), url: `${env.vietnambizDataBaseUrl.replace(/\/$/, "")}/macro-economic` };
}

export async function getVnbRates(): Promise<{ rows: VnbRateRow[]; url: string }> {
  const html = await getVnbDatasetText("currency-interest-rate");
  return { rows: parseVnbRatesRows(html), url: `${env.vietnambizDataBaseUrl.replace(/\/$/, "")}/currency-interest-rate` };
}
