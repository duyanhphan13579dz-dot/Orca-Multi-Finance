import "server-only";
import { env } from "../env";
import { cached } from "../cache";
import { httpText } from "../http";
import { currencyForUnit, type RawCommodityQuote } from "./commodities";

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

class VnbDataError extends Error {
  constructor(message: string, readonly provider: string) {
    super(message);
    this.name = "VnbDataError";
  }
}

export const VN_DATA_PROVIDER = "vietnambiz-data";
export const VN_DATA_SOURCE = "VietnamBiz Data (WiFeed)";

/** Headers kiểu Chrome (UA thật ở http.ts) — WAF WiGroup chặn request thiếu
 *  sec-ch-ua/*sec-fetch-* (thường trả 403/429 → mọi mục UNAVAILABLE). */
const DATA_PORTAL_HEADERS: Record<string, string> = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
  "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  Referer: "https://data.vietnambiz.vn/",
};

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

/**
 * Quét nốt CSS còn sót Ở DẠNG TEXT (ANTD cssinjs có thể đặt critical CSS làm
 * text trong cell, không bọc <style>): `.css-xxx{…}`, `,where(.css-ls3dc0f)
 * [class^="ant-typography"]…{…}`, `@media…`, khai báo `font-weight:…`…
 * Lặp tới khi sạch (block `{…}` có thể lồng nhau).
 */
function stripCssText(raw: string): string {
  let t = raw;
  for (let i = 0; i < 6; i++) {
    const prev = t;
    t = t
      .replace(/\{[^{}]*\}/g, " ")
      .replace(/where\([^)]*\)/gi, " ")
      .replace(/\[[^\]]{0,160}\]/g, " ")
      .replace(/\.css-[a-zA-Z0-9_-]+/g, " ")
      .replace(/@media[^{;]*/gi, " ")
      .replace(/(?:font-weight|font-family|font-size|line-height|box-sizing|color|content|background|border|text-[\w-]+)\s*:\s*[^,;{}]+[;,]/gi, " ")
      .replace(/(?:font-weight|font-family|font-size|line-height|box-sizing|color|content|background)\s*:\s*[^,;{}]+/gi, " ")
      .replace(/(?::|::)(?:before|after|first-child|last-child|not)\b/gi, " ")
      .replace(/(?:\s+,)+(?=\s|$)/g, " ");
    if (t === prev) break;
  }
  return t;
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

const isCssJunk = (s: string) =>
  /\.css-|where\(|\{|\}|ant-typography|font-(?:weight|family|size)|line-height|box-sizing|content:|color:inherit|@media/.test(s);

/** cell đã cellText() nhưng vẫn lẫn CSS dạng text → trả về "" (không hiện rác). */
const cleanCell = (s: string | null | undefined): string => {
  const t = stripCssText((s ?? "").trim());
  if (isCssJunk(t)) return "";
  // rác CSS có thể để sót dấu phân cách ở đầu/cuối (", Giá heo hơi…", "…, "):
  // cắt bỏ nhưng không đụng dấu phẩy TRONG tên ("RON 95-II,III", "30x30cm, L=18m").
  return t.replace(/^[\s,;:.\-–•|]+/, "").replace(/[\s,;:.\-–•|]+$/, "").replace(/\s+/g, " ").trim();
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
 * Tách rows từ các BẢNG THẬT. Mỗi bảng: tìm hàng header (theo token, SAU khi
 * clean CSS) ở vị trí bất kỳ; nếu có → lấy các hàng dữ liệu phía sau. Bảng
 * CSS-dump / bảng không có header khớp bị loại. Không phụ thuộc cell đầu tiên
 * (thead có thể chứa nhiều row/sticky header).
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
    const headerIdx = rows.findIndex((r) => headerMatches(r, expectedHeaders));
    if (headerIdx >= 0) out.push(...rows.slice(headerIdx + 1));
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
 * Mapping WiFeed row → catalog key — 66 dòng = TOÀN BỘ bảng /goods
 * (user directive 2026-09-06: nguồn duy nhất). Không quy đổi tiền tệ:
 * unit/currency lấy NGUYÊN VĂN từ trang. scale 1000 chỉ cho SJC (trang ghi
 * "Đồng/lượng" nhưng giá 147,600 là nghìn đồng/lượng — đối chiếu SJC thực tế).
 */
interface VnbGoodsMap {
  rx: RegExp;
  key: string;
  scale?: number;
}

const RX = (s: string) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
const R = (name: string, key: string, scale?: number): VnbGoodsMap => ({ rx: RX(name), key, scale });

export const VNB_GOODS_MAP: VnbGoodsMap[] = [
  // Hàng tiêu dùng (15)
  R("Giá heo hơi trong nước", "pig-vn"),
  R("Vải cotton Trung Quốc", "cotton-fabric-cn"),
  R("Sợi cotton Trung Quốc", "cotton-yarn-cn"),
  R("Dầu cọ Malaysia", "palm-oil"),
  R("Giấy gợn sóng Trung Quốc", "kraft-paper"),
  R("Đường", "sugar"),
  R("Cà phê", "coffee"),
  R("Giá cà phê trong nước", "coffee-robusta"),
  R("Hồ tiêu", "pepper"),
  R("Vải cotton Mỹ", "cotton-fabric-us"),
  R("Gạo TPXK", "rice"),
  R("Tôm thẻ", "shrimp-vn"),
  R("Lúa", "paddy"),
  R("Gạo nguyên liệu", "rice-raw"),
  R("Phụ phẩm lúa gạo", "rice-byproduct"),
  // Kim loại và phi kim (10)
  R("Quặng sắt Trung Quốc", "iron-ore"),
  R("Chì Trung Quốc", "lead"),
  R("Kẽm Trung Quốc", "zinc"),
  R("Nhôm Trung Quốc", "aluminum"),
  R("Đồng Trung Quốc", "copper-cn"),
  R("Nikken Trung Quốc", "nickel"),
  R("Giá vàng", "gold"),
  R("Giá vàng trong nước", "sjc-gold", 1000),
  R("Giá bạc", "silver"),
  R("Giá đồng", "copper"),
  // Hóa chất (7)
  R("Ure Trung Đông", "urea"),
  R("Lưu huỳnh Trung Quốc", "sulfur"),
  R("Phốt pho vàng Trung Quốc", "yellow-phosphorus"),
  R("Xút (NaOH) Trung Quốc", "caustic-soda"),
  R("Phân Urea Trung Quốc", "urea-cn"),
  R("Phân Ure Phú Mỹ", "urea-phu-my"),
  R("Phân Ure Cà Mau", "urea-ca-mau"),
  // Vật liệu xây dựng (20)
  R("Thép phế Anh", "steel-scrap"),
  R("Thép thanh Anh", "steel-rebar"),
  R("HRC Trung Quốc", "steel"),
  R("Đá 0-4", "aggregate-04"),
  R("Đá mi sàng", "aggregate-sieve"),
  R("Đá 1x2", "aggregate-1x2"),
  R("Đá Hộc", "aggregate-boulder"),
  R("Tôn lạnh màu Hoa Sen 0,45mm", "sheet-color"),
  R("Tôn lạnh Hoa Sen 0,45mm", "sheet"),
  { rx: /^Bê tông nhựa mịn\s*:\s*Carboncor Asphalt - CA 9\.5$/, key: "asphalt" },
  R("Ống nhựa 27 x 1.8mm", "pipe-27"),
  R("Ống nhựa 60 x 2mm", "pipe-60"),
  R("Ống nhựa 90 x 2,9mm", "pipe-90"),
  R("Sơn lót kháng kiềm cao cấp", "paint-primer"),
  R("Sơn nội thất tiêu chuẩn STANDARD", "paint-interior"),
  R("Sơn ngoại thất STANDARD", "paint-exterior"),
  R("Xi măng - Vicem Hà Tiên PCB 40 - bao 50kg", "cement"),
  R("Bê tông thương phẩm - Mác 300", "concrete"),
  R("Gạch đất sét nung - Gạch ống 4 lỗ 80x80x80", "brick"),
  R("Cọc bê tông dự ứng lực - Cọc 30x30cm, L=18m", "pile"),
  // Năng lượng (10)
  R("Than cốc Trung Quốc", "coal"),
  R("Khí LPG Trung Quốc", "lpg"),
  R("Dầu WTI", "wti"),
  R("Khí thiên nhiên", "natgas"),
  R("Than Newcastle", "coal-newcastle"),
  R("Xăng RON 95-V", "gasoline-95-v"),
  R("Xăng RON 95-II,III", "gasoline-95"),
  R("Xăng sinh học E5 RON 92-II", "gasoline-92"),
  R("Xăng Diezen", "diesel"),
  R("Dầu hoả", "kerosene"),
  // Nhựa và cao su (4)
  R("Cao su Nhật Bản", "rubber"),
  R("PET Trung Quốc", "pet"),
  R("Hạt nhựa PVC Trung Quốc", "pvc"),
  R("Hạt nhựa PP Trung Quốc", "pp"),
];

export const VNB_GOODS_KEYS: ReadonlySet<string> = new Set(VNB_GOODS_MAP.map((m) => m.key));

/** normalize: bỏ dấu/hoa thường/khoảng trắng & punctuation → chuỗi khớp bền. */
function normGoods(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** khớp dài nhất trước (để "Giá vàng trong nước" → sjc-gold, không trúng "gold"). */
const FUZZY = [...VNB_GOODS_MAP].sort((a, b) => normGoods(b.rx.source).length - normGoods(a.rx.source).length);

export function matchVnbGoods(name: string): VnbGoodsMap | null {
  // 1) chính xác (nhanh, không sai)
  for (const m of VNB_GOODS_MAP) if (m.rx.test(name)) return m;
  // 2) bền: cho phép rác CSS còn sót ở đầu/cuối hoặc label đổi nhẹ (containment)
  const n = normGoods(name);
  if (!n) return null;
  for (const m of FUZZY) {
    const k = normGoods(m.rx.source.replace(/^\^/, "").replace(/\$$/, ""));
    // đòi hỏi khớp cả TÊN (không phải chỉ unit) để tránh false-positive
    if (k.length >= 4 && n.includes(k)) return m;
  }
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
      unit: row.unit,
      currency: currencyForUnit(row.unit),
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
    // WiFeed cập nhật theo NGÀY — cache 3 phút (không phải 3s) là đủ và tránh
    // bị WAF rate-limit khi client poll 3s (tổng hợp commodities:all vẫn tươi 3s
    // vì đọc từ cache này + các cache per-source khác).
    // WiFeed chỉ refresh 1 lần/ngày (00:00 — user xác nhận 2026-09-06):
    // cache 6h (mặc định) tránh bị WAF chặn vì poll quá dày; stale 48h cho
    // last-known khi nguồn tạm lỗi.
    ttlMs: env.vnbDataTtlMs,
    staleMs: 48 * 3_600_000,
    producer: async () => {
      let attempt = 0;
      const fetchOnce = async (): Promise<string> => {
        const r = await httpText(url, {
          provider: VN_DATA_PROVIDER,
          timeoutMs: 12_000,
          retries: 1,
          headers: DATA_PORTAL_HEADERS,
        });
        if (!r.ok || !r.text) {
          // WAF có thể trả 403/404 thay vì 429 — retry thêm 1 lần sau 3s
          // (cached() dedupe in-flight nên không tạo thêm áp lực)
          if ((r.status === 403 || r.status === 404) && attempt < 1) {
            attempt += 1;
            await new Promise((res) => setTimeout(res, 3_000));
            return fetchOnce();
          }
          throw new VnbDataError(`vietnambiz-data: ${r.error ?? "unreachable"} (${url})`, VN_DATA_PROVIDER);
        }
        return r.text;
      };
      return fetchOnce();
    },
  });
  return res.value;
}

export async function getVnbGoodsQuotes(): Promise<Map<string, RawCommodityQuote>> {
  const html = await getVnbDatasetText("goods");
  const rows = parseVnbGoodsRows(html);
  const mapped = mapVnbGoodsRows(rows);
  if (mapped.size === 0) {
    const sample = rows
      .slice(0, 8)
      .map((r) => `${r.name} [${r.unit}] ${r.price}`)
      .join(" | ");
    throw new VnbDataError(
      `vietnambiz-data: goods page parse failed (structure changed?) — rows=${rows.length}, htmlChars=${html.length}, sample=${sample.slice(0, 400)}`,
      VN_DATA_PROVIDER,
    );
  }
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
