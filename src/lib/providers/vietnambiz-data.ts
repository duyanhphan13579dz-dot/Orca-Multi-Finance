import "server-only";
import { env } from "../env";
import { cached } from "../cache";
import { httpText } from "../http";
import { COMMODITY_CATALOG, currencyForUnit, type RawCommodityQuote } from "./commodities";

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
      .replace(/@(?:media|supports|keyframes|-webkit-keyframes)[^{;]*/gi, " ")
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

/** Bản THÔ đã strip tối đa nhưng KHÔNG zero-out khi còn rác — dùng cho vòng map 2/3. */
const softCleanCell = (s: string | null | undefined): string => {
  const t = stripCssText((s ?? "").trim());
  return t.replace(/^[\s,;:.\-–•|]+/, "").replace(/[\s,;:.\-–•|]+$/, "").replace(/\s+/g, " ").trim();
};

/** Giá lenient: khi cell giá còn rác CSS, chỉ tin số có dấu nghìn (CSS không có
 *  dạng "57,833") hoặc số sạch sau khi strip. Không bao giờ lấy "14px" làm giá. */
function parsePriceLenient(raw: string | null | undefined): number | null {
  const t = stripCssText(stripHtmlScaffolding(raw ?? "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (isCssJunk(t)) {
    const m = t.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?/);
    return m ? parseVnbNum(m[0]) : null;
  }
  const m = t.match(/[+-]?\d[\d.,]*/);
  return m ? parseVnbNum(m[0]) : null;
}

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
  /** tên đã rửa CSS sạch (có thể "" nếu cell tên còn rác không rửa được) */
  name: string;
  /** bản thô đã strip tối đa — phương án 2/3 khi name bị rác */
  rawName: string;
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
    const rawName = softCleanCell(decodeEntities(parts[0] ?? ""));
    const name = cleanCell(decodeEntities(parts[0]));
    const unit = cleanCell(parts.length > 1 ? decodeEntities(parts.slice(1).join(" ")) : "");
    // KHÔNG drop khi tên bẩn (CSS sót / wrapper lạ): giữ rawName để map vòng 2-3
    // khớp lại; chỉ bỏ header/CSS-dump hoàn toàn (rawName rỗng hoặc là "Mặt hàng").
    if (!rawName || /^(Mặt hàng|Chỉ tiêu)$/i.test(rawName)) continue;
    const price = parseVnbNum(priceRaw) ?? parsePriceLenient(priceRaw);
    if (price == null) continue; // "--" / header → bỏ
    out.push({
      name,
      rawName,
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
 * unit/currency ưu tiên NGUYÊN VĂN từ trang; khi cell đơn vị bị rác → dùng
 * unit/currency của catalog (không còn hiện "USD" cho hàng Việt Nam).
 * scale 1000 chỉ cho SJC (trang ghi "Đồng/lượng" nhưng giá 147,600 là
 * nghìn đồng/lượng — đối chiếu SJC thực tế).
 */
interface VnbGoodsMap {
  rx: RegExp;
  key: string;
  /** tên gốc (canonical) — dùng cho fuzzy, KHÔNG lấy từ rx.source (chứa meta regex) */
  name: string;
  unit: string;
  scale?: number;
}

/** def theo key (unit/currency chuẩn catalog) — không tạo cycle (commodities không import vietnambiz-data). */
const DEF_BY_KEY = new Map<string, { unit: string; currency: string }>(
  COMMODITY_CATALOG.map((d) => [d.key, { unit: d.unit, currency: d.currency }]),
);

const RX = (s: string) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
const R = (name: string, key: string, scale?: number): VnbGoodsMap => ({
  rx: RX(name),
  key,
  name,
  unit: DEF_BY_KEY.get(key)?.unit ?? "",
  scale,
});

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
  R("Bê tông nhựa mịn : Carboncor Asphalt - CA 9.5", "asphalt"),
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
const FUZZY = [...VNB_GOODS_MAP].sort((a, b) => normGoods(b.name).length - normGoods(a.name).length);

/** fuzzy containment trên TÊN GỐC (không dùng rx.source — tránh meta regex như \s). */
function matchFuzzy(text: string): VnbGoodsMap | null {
  const n = normGoods(text);
  if (n.length < 3) return null;
  const hits = FUZZY.filter((m) => {
    const k = normGoods(m.name);
    return k.length >= 3 && n.includes(k);
  });
  if (!hits.length) return null;
  hits.sort((a, b) => normGoods(b.name).length - normGoods(a.name).length);
  const best = normGoods(hits[0].name).length;
  const top = hits.filter((m) => normGoods(m.name).length === best);
  return top.length === 1 ? top[0] : null; // nhiều ứng viên dài bằng nhau → để positional lo
}

export function matchVnbGoods(name: string): VnbGoodsMap | null {
  // 1) chính xác (nhanh, không sai)
  for (const m of VNB_GOODS_MAP) if (m.rx.test(name)) return m;
  // 2) bền: rác sót đầu/cuối, label đổi nhẹ → containment theo tên gốc
  return matchFuzzy(name);
}

/** Đơn vị tương đương (trang "USD/ounce" == catalog "USD/oz", "USD/thùng" == "USD/bbl"…). */
const UNIT_EQ: Record<string, string> = {
  "usd/oz": "usd/ounce",
  "usd/lb": "usd/pound",
  "usd/bbl": "usd/thung",
};
function normUnit(u: string | null | undefined): string {
  const s = (u ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9/]/g, "");
  return UNIT_EQ[s] ?? s;
}
function unitCompatible(rowUnit: string | null | undefined, defUnit: string): boolean {
  if (!rowUnit || !rowUnit.trim()) return true; // cell đơn vị bị rác → tin catalog
  return normUnit(rowUnit) === normUnit(defUnit) || defUnit === "";
}

/** Map parsed WiFeed rows → quotes theo catalog key.
 *  Vòng 1: exact/fuzzy theo name · Vòng 2: fuzzy theo rawName (tên bị rác CSS)
 *  · Vòng 3: POSITIONAL — bảng /goods cố định 66 dòng, zip theo thứ tự + đơn vị. */
export function mapVnbGoodsRows(rows: VnbGoodsRow[]): Map<string, RawCommodityQuote> {
  return mapVnbGoodsRowsDetailed(rows).mapped;
}

export function mapVnbGoodsRowsDetailed(rows: VnbGoodsRow[]): { mapped: Map<string, RawCommodityQuote>; unmatched: VnbGoodsRow[] } {
  const out = new Map<string, RawCommodityQuote>();
  const claimed = new Set<number>();

  const bind = (i: number, m: VnbGoodsMap): boolean => {
    if (out.has(m.key) || claimed.has(i)) return false;
    const row = rows[i];
    const price = row.price == null ? null : row.price * (m.scale ?? 1);
    if (price == null || price <= 0) return false;
    // unit ưu tiên nguyên văn trang; rác/trống → def catalog (sửa "USD" cho hàng VN)
    const unit = row.unit && row.unit.trim() ? row.unit : m.unit;
    out.set(m.key, {
      source: VN_DATA_SOURCE,
      price,
      change: null,
      changePercent: row.pctDay,
      unit,
      currency: currencyForUnit(unit),
      timestamp: row.dateTs,
      url: `${env.vietnambizDataBaseUrl.replace(/\/$/, "")}/goods`,
    });
    claimed.add(i);
    return true;
  };

  // Vòng 1: tên sạch
  rows.forEach((row, i) => {
    const m = matchVnbGoods(row.name);
    if (m) bind(i, m);
  });
  // Vòng 2: tên thô (cell còn rác → name="")
  rows.forEach((row, i) => {
    if (claimed.has(i)) return;
    const m = matchVnbGoods(row.rawName);
    if (m) bind(i, m);
  });
  // Vòng 3: positional — zip hàng chưa claim với key chưa map theo đúng thứ tự bảng
  const freeRows = rows.map((r, i) => ({ r, i })).filter((x) => !claimed.has(x.i));
  const freeMaps = VNB_GOODS_MAP.filter((m) => !out.has(m.key));
  for (let k = 0; k < Math.min(freeRows.length, freeMaps.length); k++) {
    if (!unitCompatible(freeRows[k].r.unit, freeMaps[k].unit)) continue;
    bind(freeRows[k].i, freeMaps[k]);
  }
  return { mapped: out, unmatched: rows.filter((_, i) => !claimed.has(i)) };
}

/** Hàng KHÔNG bind được sau cả 3 vòng (chẩn đoán — /api/v1/vietnambiz-data + lỗi provider). */
export function unmatchedVnbGoodsRows(rows: VnbGoodsRow[]): VnbGoodsRow[] {
  return mapVnbGoodsRowsDetailed(rows).unmatched;
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
    const unmatched = unmatchedVnbGoodsRows(rows)
      .slice(0, 10)
      .map((r) => `"${r.rawName || r.name || "?"}" [${r.unit || "?"}] ${r.price}`)
      .join(" | ");
    throw new VnbDataError(
      `vietnambiz-data: goods page parse failed (structure changed?) — rows=${rows.length}, mapped=0, htmlChars=${html.length}, unmatched=${unmatched.slice(0, 400)}`,
      VN_DATA_PROVIDER,
    );
  }
  return mapped;
}

/** Raw snapshot (tất cả hàng WiFeed) + mapped quotes — cho API diagnostics. */
export async function getVnbGoodsSnapshot(): Promise<{ rows: VnbGoodsRow[]; mapped: Record<string, RawCommodityQuote>; unmatched: { name: string; rawName: string; unit: string; price: number | null }[] }> {
  const html = await getVnbDatasetText("goods");
  const rows = parseVnbGoodsRows(html);
  const mapped: Record<string, RawCommodityQuote> = {};
  for (const [k, q] of mapVnbGoodsRows(rows)) mapped[k] = q;
  return {
    rows,
    mapped,
    unmatched: unmatchedVnbGoodsRows(rows).map((r) => ({ name: r.name, rawName: r.rawName, unit: r.unit, price: r.price })),
  };
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
