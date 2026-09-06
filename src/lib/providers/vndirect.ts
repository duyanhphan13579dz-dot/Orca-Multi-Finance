import "server-only";
import { env } from "../env";
import { httpJson } from "../http";
import type { OhlcvBar, Quote, IndexQuote } from "../types";
import { ProviderError } from "./binance";

/**
 * VNDIRECT PROVIDER (Phase 5) — Vietnam Stock Data Provider CHÍNH.
 *
 * Mọi dữ liệu chứng khoán Việt Nam (quotes, indices, OHLCV, financial
 * statements, ratios, order book top-of-book) đi qua VNDirect finfo REST
 * (`finfo-api.vndirect.com.vn`, keyless public; base URL env-overridable).
 *
 * Nguyên tắc:
 *  - Không bao giờ suy diễn: payload lỗi/thiếu → throw ProviderError (service
 *    tầng trên trả UNAVAILABLE) — KHÔNG có dữ liệu giả.
 *  - Normalizers là hàm thuần, export để unit-test độc lập.
 *  - Dữ liệu không được VNDirect công bố (order book depth levels, analyst
 *    recommendations) trả trạng thái rõ ràng thay vì bịa.
 */

export const VNDIRECT = "vndirect";

const base = () => (env.vndirectBaseUrl ?? "https://finfo-api.vndirect.com.vn").replace(/\/$/, "");

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(/[,\s]/g, (m) => (m === "," ? "" : m))) : Number(v);
  return Number.isFinite(n) ? n : null;
};

const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v).trim());

const pick = (row: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};

/** percent: nhận cả dạng ratio (0.0123) lẫn dạng % (1.23) — chuẩn hoá về %. */
function asPercent(v: unknown): number | null {
  const n = num(v);
  if (n == null) return null;
  return Math.abs(n) < 1 ? n * 100 : n;
}

function tsOf(dateRaw: unknown, timeRaw?: unknown): number | null {
  const d = str(dateRaw);
  if (!d) return null;
  const t = str(timeRaw);
  if (t && /^\d{1,2}:\d{2}/.test(t)) {
    const base = `${d}T${t.length === 5 ? `${t}:00` : t}`;
    const withZone = /[Zz]|[+-]\d{2}:\d{2}$/.test(base) ? base : `${base}+07:00`;
    const p = Date.parse(withZone);
    if (Number.isFinite(p)) return p;
  }
  const p = Date.parse(d);
  return Number.isFinite(p) ? p : null;
}

/* ============================ PURE NORMALIZERS ============================ */

export interface VndQuoteRow {
  symbol: string;
  price: number;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  referencePrice: number | null;
  ceilingPrice: number | null;
  floorPrice: number | null;
  volume: number | null;
  quoteVolume: number | null;
  bidPrice: number | null;
  bidVolume: number | null;
  askPrice: number | null;
  askVolume: number | null;
  updatedAt: string | null;
  sourceTs: number | null;
}

/** stock_latest row → quote (tolerant field naming: VNDirect/ratio-style). */
export function normalizeQuoteRow(raw: Record<string, unknown>): VndQuoteRow | null {
  const symbol = String(pick(raw, ["code", "symbol", "ticker"]) ?? "").toUpperCase();
  const price = num(pick(raw, ["close", "currentPrice", "last", "matchPrice", "price"]));
  if (!symbol || price == null || price <= 0) return null;
  const date = pick(raw, ["date", "tradingDate", "reportDate"]);
  return {
    symbol,
    price,
    change: num(pick(raw, ["change", "priceChange", "adChange"])),
    changePercent: asPercent(pick(raw, ["changePercent", "change_percent", "pctChange", "changeRatio"])),
    open: num(pick(raw, ["open", "openPrice"])),
    high: num(pick(raw, ["high", "highPrice"])),
    low: num(pick(raw, ["low", "lowPrice"])),
    close: num(pick(raw, ["close"])),
    referencePrice: num(pick(raw, ["referencePrice", "reference_price", "refPrice", "basicPrice"])),
    ceilingPrice: num(pick(raw, ["ceilingPrice", "ceiling", "ceilPrice", "ceiling_price"])),
    floorPrice: num(pick(raw, ["floorPrice", "floor", "floor_price"])),
    volume: num(pick(raw, ["nmVolume", "volume", "totalVolume", "cumVolume"])),
    quoteVolume: num(pick(raw, ["nmValue", "value", "totalValue", "cumValue"])),
    bidPrice: num(pick(raw, ["bidPrice", "bid", "bestBid", "bid_1_price"])),
    bidVolume: num(pick(raw, ["bidVolume", "bidVol", "bid_1_volume"])),
    askPrice: num(pick(raw, ["askPrice", "ask", "bestAsk", "ask_1_price"])),
    askVolume: num(pick(raw, ["askVolume", "askVol", "ask_1_volume"])),
    updatedAt: str(pick(raw, ["date", "tradingDate"])) ?? str(pick(raw, ["time"])),
    sourceTs: tsOf(date, pick(raw, ["time"])),
  };
}

export function normalizeQuoteRows(rows: unknown): VndQuoteRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r): r is Record<string, unknown> => r != null && typeof r === "object")
    .map((r) => normalizeQuoteRow(r))
    .filter((x): x is VndQuoteRow => x != null);
}

function toQuote(r: VndQuoteRow): Quote {
  return {
    symbol: r.symbol,
    assetClass: "stock",
    price: r.price,
    change: r.change,
    changePercent: r.changePercent,
    open: r.open,
    high: r.high,
    low: r.low,
    volume: r.volume,
    quoteVolume: r.quoteVolume,
    referencePrice: r.referencePrice,
    ceilingPrice: r.ceilingPrice,
    floorPrice: r.floorPrice,
    updatedAt: r.updatedAt,
  };
}

/** indices row → IndexQuote (tolerant: code/indexCode, value/close/indexValue…). */
export function normalizeIndexRow(raw: Record<string, unknown>): IndexQuote | null {
  const code = String(pick(raw, ["code", "indexCode", "symbol"]) ?? "").toUpperCase();
  const value = num(pick(raw, ["close", "indexValue", "value", "price", "last"]));
  if (!code || value == null || value <= 0) return null;
  return {
    code,
    name: String(pick(raw, ["name", "indexName", "shortName"]) ?? code),
    value,
    change: num(pick(raw, ["change", "pointChange"])) ?? 0,
    changePercent: asPercent(pick(raw, ["changePercent", "pctChange", "changeRatio"])) ?? 0,
    volume: num(pick(raw, ["nmVolume", "volume", "totalVolume"])) ?? null,
    updatedAt: str(pick(raw, ["date", "tradingDate"])) ?? str(pick(raw, ["time"])),
  };
}

export function normalizeIndexRows(rows: unknown): IndexQuote[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r): r is Record<string, unknown> => r != null && typeof r === "object")
    .map((r) => normalizeIndexRow(r))
    .filter((x): x is IndexQuote => x != null);
}

/** stock_prices / index_prices row → OhlcvBar (date+time → epoch ms). */
export function normalizeCandleRow(raw: Record<string, unknown>): OhlcvBar | null {
  const t = tsOf(pick(raw, ["date", "tradingDate", "time"]), pick(raw, ["time"]));
  const o = num(pick(raw, ["open"]));
  const h = num(pick(raw, ["high"]));
  const l = num(pick(raw, ["low"]));
  const c = num(pick(raw, ["close", "adClose", "nextClose"]));
  if (t == null || o == null || h == null || l == null || c == null) return null;
  return {
    time: t,
    open: o,
    high: h,
    low: l,
    close: c,
    volume: num(pick(raw, ["nmVolume", "volume"])) ?? 0,
  };
}

export function normalizeCandleRows(rows: unknown): OhlcvBar[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r): r is Record<string, unknown> => r != null && typeof r === "object")
    .map((r) => normalizeCandleRow(r))
    .filter((x): x is OhlcvBar => x != null)
    .sort((a, b) => a.time - b.time);
}

/* ------------------------ financial statements (v3) ------------------------ */

export const FIN_MODELS: Record<"income" | "balance" | "cashflow", string> = {
  income: "1,89,101,411",
  balance: "2,90,102,412",
  cashflow: "3,91,103,413",
};

export type FinancialReport = "income" | "balance" | "cashflow";
export type FinancialPeriod = "quarter" | "year";

export interface VndStatementItem {
  fiscalDate: string | null;
  year: number | null;
  quarter: number | null;
  reportType: string | null;
  itemName: string;
  itemCode: string | null;
  value: number;
}

/** hits[]._source → item rows (giữ raw period/itemName/itemCode/value). */
export function normalizeStatementHits(hits: unknown): VndStatementItem[] {
  if (!Array.isArray(hits)) return [];
  const out: VndStatementItem[] = [];
  for (const h of hits) {
    const src = (h as { _source?: Record<string, unknown> })?._source ?? h;
    if (!src || typeof src !== "object") continue;
    const date = str(pick(src as Record<string, unknown>, ["fiscalDate", "reportDate", "date"]));
    const value = num(pick(src as Record<string, unknown>, ["numericValue", "value", "amount"]));
    const itemName = String(pick(src as Record<string, unknown>, ["itemName", "name", "caption"]) ?? "");
    if (!itemName || value == null) continue;
    const q = quarterOf(date);
    out.push({
      fiscalDate: date,
      year: num(pick(src as Record<string, unknown>, ["year", "fiscalYear"])) ?? (date ? Number(date.slice(0, 4)) || null : null),
      quarter: num(pick(src as Record<string, unknown>, ["quarter", "reportQuarter"])) ?? (date ? q : null),
      reportType: str(pick(src as Record<string, unknown>, ["reportType", "periodType", "type"])),
      itemName,
      itemCode: str(pick(src as Record<string, unknown>, ["itemCode", "lineCode"])),
      value,
    });
  }
  return out;
}

function quarterOf(date: string | null): number | null {
  if (!date) return null;
  const m = Number(date.slice(5, 7));
  if (m === 3) return 1;
  if (m === 6) return 2;
  if (m === 9) return 3;
  if (m === 12) return 4;
  return null;
}

/** Canonical mapping VNDirect itemName → canonical key (cho quant engine). */
const CANON: [RegExp, string][] = [
  [/doanh thu thuan|doanh thu ban|doanh thu net|revenue/i, "revenue"],
  [/loi nhuan gop|gross profit/i, "grossProfit"],
  [/loi nhuan thuan tu hoat dong kinh doanh|loi nhuan tu hoat dong kinh doanh|operating profit/i, "ebit"],
  [/ebitda/i, "ebitda"],
  [/chi phi lai vay|lai vay phai tra|interest expense/i, "interestExpense"],
  [/loi nhuan sau thue|loi nhuan rong|net profit|profit for the year/i, "netProfit"],
  [/tong cong tai san|tong tai san|total assets/i, "totalAssets"],
  [/tai san ngan han|current assets/i, "currentAssets"],
  [/tong cong no phai tra|no phai tra|total liabilities/i, "totalLiabilities"],
  [/no ngan han|current liabilities/i, "currentLiabilities"],
  [/von chu so huu|owner'?s equity|total equity/i, "equity"],
  [/tien va cac khoan tuong duong tien|tien va tuong duong tien|cash and cash equivalents/i, "cash"],
  [/vay va no ngan han|vay ngan han|short.?term debt/i, "shortDebt"],
  [/vay va no dai han|vay dai han|long.?term debt/i, "longDebt"],
  [/hang ton kho|inventor/i, "inventory"],
  [/phai thu ngan han|accounts receivable|receivable/i, "receivables"],
  [/luu chuyen tien thuan tu hoat dong kinh doanh|luu chuyen tien tu hoat dong kinh doanh|operating cash flow|net cash flow from operating/i, "ocf"],
  [/mua sam,? xay dung tai san co dinh|mua sam tai san co dinh|purchase.*fixed assets|capex/i, "capex"],
  [/co tuc da tra|cổ tức đã trả|dividends? paid/i, "dividends"],
  [/loi nhuan co ban tren co phieu|earnings per share|^eps$/i, "eps"],
  [/gia tri so sach tren co phieu|book value per share|^bvps$/i, "bvps"],
  [/co phieu dang luu hanh|shares outstanding/i, "shares"],
];

/** Khử dấu tiếng Việt để so khớp itemName (VNDirect trả tên có dấu). */
function stripDiacritics(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

const norm = (s: string) => stripDiacritics(s);

export function canonicalKey(itemName: string): string | null {
  const n = norm(itemName);
  for (const [re, key] of CANON) if (re.test(n) || re.test(itemName)) return key;
  return null;
}

/** Pivot: một ROW mỗi kỳ, key số = itemName (+ canonical) — UI & quant engine dùng chung. */
export function pivotStatement(items: VndStatementItem[]): Record<string, unknown>[] {
  const byPeriod = new Map<string, Record<string, unknown>>();
  for (const it of items) {
    const key = it.fiscalDate ?? `${it.year ?? "?"}-Q${it.quarter ?? "?"}`;
    let row = byPeriod.get(key);
    if (!row) {
      row = {
        period: it.fiscalDate,
        year: it.year,
        quarter: it.quarter,
        reportType: it.reportType ?? null,
        _itemCodes: {},
      };
      byPeriod.set(key, row);
    }
    const numeric = it.value;
    row[it.itemName] = numeric;
    const canon = canonicalKey(it.itemName);
    if (canon) row[canon] = numeric;
    const codes = row._itemCodes as Record<string, string>;
    if (it.itemCode) codes[it.itemName] = it.itemCode;
  }
  return [...byPeriod.values()].sort((a, b) => String(b.period ?? "").localeCompare(String(a.period ?? "")));
}

/* ------------------------------- ratios (v4) ------------------------------- */

export interface VndRatioRow {
  reportDate: string | null;
  itemName: string;
  itemCode: string | null;
  value: number;
}

export function normalizeRatioRows(rows: unknown): VndRatioRow[] {
  if (!Array.isArray(rows)) return [];
  const out: VndRatioRow[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    const itemName = String(pick(row, ["itemName", "name"]) ?? "");
    const value = num(pick(row, ["value", "numericValue"]));
    if (!itemName || value == null) continue;
    out.push({
      reportDate: str(pick(row, ["reportDate", "date", "fiscalDate"])),
      itemName,
      itemCode: str(pick(row, ["itemCode"])),
      value,
    });
  }
  return out;
}

export const RATIO_NAME_PATTERNS: [RegExp, string][] = [
  [/\bpe\b|p\/e|giá\/eps|gia\/eps|eps ratio/i, "P/E"],
  [/\bpb\b|p\/b|gia\/bvps|price to book/i, "P/B"],
  [/\broe\b|return on equity|loi nhuan tren von/i, "ROE"],
  [/\broa\b|return on assets|loi nhuan tren tai san/i, "ROA"],
  [/\begm\b|gross margin|bien loi nhuan gop/i, "Gross Margin"],
  [/\bopm\b|operating margin|bien loi nhuan hoat dong/i, "Operating Margin"],
  [/\bnpm\b|net margin|bien loi nhuan rong/i, "Net Margin"],
  [/debt.*equity|no tren von/i, "Debt/Equity"],
  [/current ratio|thanh toan ngan han/i, "Current Ratio"],
  [/quick ratio|thanh toan nhanh/i, "Quick Ratio"],
  [/eps\b/i, "EPS"],
  [/bvps\b/i, "BVPS"],
];

/** VNDirect ratio row có itemName nhận diện được → key chuẩn (nếu không → raw itemName). */
export function ratioKey(itemName: string): string {
  for (const [re, key] of RATIO_NAME_PATTERNS) if (re.test(itemName)) return key;
  return itemName;
}

export function pivotRatioRows(rows: VndRatioRow[]): Record<string, unknown>[] {
  const byPeriod = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const key = r.reportDate ?? "latest";
    const row = byPeriod.get(key) ?? { period: r.reportDate, year: r.reportDate ? Number(r.reportDate.slice(0, 4)) || null : null };
    row[ratioKey(r.itemName)] = r.value;
    byPeriod.set(key, row);
  }
  return [...byPeriod.values()].sort((a, b) => String(b.period ?? "").localeCompare(String(a.period ?? "")));
}

/* ------------------------------ order book (F) ----------------------------- */

export interface OrderBookLevel {
  price: number;
  volume: number;
}

export interface VndOrderBook {
  symbol: string;
  timestamp: number | null;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  totalBidVolume: number | null;
  totalAskVolume: number | null;
  depthStatus: "TOP_OF_BOOK" | "UNAVAILABLE";
  note: string | null;
}

/** VNDirect finfo chỉ công bố TOP-OF-BOOK (bid/ask 1); depth levels → UNAVAILABLE (không bịa). */
export function normalizeOrderBook(symbol: string, quote: VndQuoteRow | null): VndOrderBook {
  if (!quote) {
    return { symbol, timestamp: null, bids: [], asks: [], bestBid: null, bestAsk: null, spread: null, totalBidVolume: null, totalAskVolume: null, depthStatus: "UNAVAILABLE", note: "VNDirect finfo không trả order book cho mã này." };
  }
  const bids: OrderBookLevel[] = quote.bidPrice != null && quote.bidVolume != null ? [{ price: quote.bidPrice, volume: quote.bidVolume }] : [];
  const asks: OrderBookLevel[] = quote.askPrice != null && quote.askVolume != null ? [{ price: quote.askPrice, volume: quote.askVolume }] : [];
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  return {
    symbol,
    timestamp: quote.sourceTs,
    bids,
    asks,
    bestBid,
    bestAsk,
    spread: bestBid != null && bestAsk != null && bestAsk >= bestBid ? bestAsk - bestBid : null,
    totalBidVolume: bids.length ? bids.reduce((a, b) => a + b.volume, 0) : null,
    totalAskVolume: asks.length ? asks.reduce((a, b) => a + b.volume, 0) : null,
    depthStatus: bids.length && asks.length ? "TOP_OF_BOOK" : "UNAVAILABLE",
    note: "VNDirect finfo công bố top-of-book (bid/ask tốt nhất); depth levels nhiều mức không có trong REST public — không suy diễn.",
  };
}

/* ------------------------- company profile / universe ---------------------- */

export interface VndCompanyProfile {
  symbol: string;
  name: string | null;
  shortName: string | null;
  exchange: string | null;
  industry: string | null;
  listingDate: string | null;
  establishedYear: number | null;
  charterCapital: number | null;
  foreignPercent: number | null;
  status: string | null;
}

export function normalizeProfileRow(raw: Record<string, unknown>): VndCompanyProfile | null {
  const symbol = String(pick(raw, ["code", "symbol", "ticker"]) ?? "").toUpperCase();
  if (!symbol) return null;
  return {
    symbol,
    name: str(pick(raw, ["companyName", "organName", "name"])),
    shortName: str(pick(raw, ["shortName", "stockName"])),
    exchange: str(pick(raw, ["exchange", "market", "floor", "stockExchange"]))?.toUpperCase() ?? null,
    industry: str(pick(raw, ["industry", "industryName", "icbIndustryName", "sector"])),
    listingDate: str(pick(raw, ["listingDate", "listedDate", "dateOfListing"])),
    establishedYear: num(pick(raw, ["establishedYear", "yearOfEstablishment", "foundedYear"])),
    charterCapital: num(pick(raw, ["charterCapital", "charterCapitalValue"])),
    foreignPercent: num(pick(raw, ["foreignPercent", "foreignOwnershipPercent"])),
    status: str(pick(raw, ["status"])),
  };
}

export function normalizeProfileRows(rows: unknown): VndCompanyProfile[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r): r is Record<string, unknown> => r != null && typeof r === "object")
    .map((r) => normalizeProfileRow(r))
    .filter((x): x is VndCompanyProfile => x != null);
}

/* ================================ CLIENTS ================================= */

async function vndGet<T>(path: string, timeoutMs = 9_000): Promise<T> {
  const res = await httpJson<T>(`${base()}${path}`, { provider: VNDIRECT, timeoutMs, retries: 1 });
  if (!res.ok || res.data == null) {
    throw new ProviderError(`vndirect: ${res.error ?? "unreachable"} ${path}`, VNDIRECT);
  }
  return res.data;
}

/** B — quotes (toàn bộ mã HOSE/HNX/UPCOM qua từng chunk ≤40). */
export async function getVndQuotes(symbols: string[]): Promise<{ quotes: Quote[]; sourceTs: number | null }> {
  const syms = [...new Set(symbols.filter((s) => /^[A-Z0-9]{3,6}$/i.test(s)).map((s) => s.toUpperCase()))].slice(0, 40);
  if (!syms.length) return { quotes: [], sourceTs: null };
  const rows = await vndGet<{ data?: unknown }>(`/v4/stock_latest?q=code:${syms.join(",")}&size=${syms.length}`);
  const normalized = normalizeQuoteRows(rows.data);
  if (!normalized.length) throw new ProviderError("vndirect: empty quotes payload", VNDIRECT);
  const sourceTs = normalized.reduce((acc, r) => (r.sourceTs != null && r.sourceTs > acc ? r.sourceTs : acc), 0) || null;
  return { quotes: normalized.map(toQuote), sourceTs };
}

/** per-symbol quote thô (order book / profile enrichment). */
export async function getVndQuoteRaw(symbol: string): Promise<VndQuoteRow | null> {
  const sym = symbol.toUpperCase();
  const rows = await vndGet<{ data?: unknown }>(`/v4/stock_latest?q=code:${sym}&size=1`);
  const normalized = normalizeQuoteRows(rows.data);
  return normalized.find((r) => r.symbol === sym) ?? normalized[0] ?? null;
}

/** A — indices snapshot (VNINDEX, VN30, HNXINDEX, UPCOMINDEX…). */
export async function getVndIndices(): Promise<{ items: IndexQuote[]; sourceTs: number | null }> {
  const rows = await vndGet<{ data?: unknown }>(`/v4/indices?size=50`);
  const items = normalizeIndexRows(rows.data);
  if (!items.length) throw new ProviderError("vndirect: empty indices payload", VNDIRECT);
  const sourceTs = items.reduce((acc, r) => {
    const t = r.updatedAt ? Date.parse(r.updatedAt) : NaN;
    return Number.isFinite(t) && t > acc ? t : acc;
  }, 0) || null;
  return { items, sourceTs };
}

/** C — index historical OHLCV. */
export async function getVndIndexOhlcv(code: string, limit = 250): Promise<OhlcvBar[]> {
  const c = encodeURIComponent(code.toUpperCase());
  const rows = await vndGet<{ data?: unknown }>(`/v4/index_prices?sort=date:desc&q=code:${c}&size=${Math.min(limit, 1000)}&fields=code,date,time,open,high,low,close,nmVolume,nmValue`);
  const bars = normalizeCandleRows(rows.data);
  if (!bars.length) throw new ProviderError(`vndirect: empty index ohlcv ${c}`, VNDIRECT);
  return bars.slice(-limit);
}

/** C — stock daily OHLCV (nguồn chart; intraday xem Multi-TF realtime engine). */
export async function getVndOhlcv(symbol: string, size = 250): Promise<OhlcvBar[]> {
  const s = encodeURIComponent(symbol.toUpperCase());
  const rows = await vndGet<{ data?: unknown }>(`/v4/stock_prices?sort=date:desc&q=code:${s}&size=${Math.min(size, 1000)}&fields=code,date,time,open,high,low,close,nmVolume,nmValue,adClose`);
  const bars = normalizeCandleRows(rows.data);
  if (!bars.length) throw new ProviderError(`vndirect: empty ohlcv ${s}`, VNDIRECT);
  return bars.slice(-size);
}

/** company profile — name/exchange/industry và metadata niêm yết. */
export async function getVndCompanyProfile(symbol: string): Promise<VndCompanyProfile | null> {
  const sym = symbol.toUpperCase();
  const rows = await vndGet<{ data?: unknown }>(`/v4/company_profile?q=code:${sym}&size=1`);
  const profiles = normalizeProfileRows(rows.data);
  return profiles.find((p) => p.symbol === sym) ?? profiles[0] ?? null;
}

/** legacy universe (HOSE/HNX/UPCOM + name/exchange); thất bại → rỗng (master giữ role canonical). */
export async function getVndUniverse(): Promise<VndCompanyProfile[]> {
  const rows = await vndGet<{ data?: unknown }>(`/stocks?status=all`, 12_000);
  return normalizeProfileRows(rows.data).filter((p) => p.symbol.length >= 3);
}

/** D — financial statements (v3 financialStatement) → pivot rows cho UI + quant engine. */
export async function getVndFinancials(symbol: string, report: FinancialReport, period: FinancialPeriod, limit = 12): Promise<Record<string, unknown>[]> {
  const sym = symbol.toUpperCase();
  const to = new Date();
  const from = new Date(to);
  from.setFullYear(from.getFullYear() - (period === "year" ? Math.min(limit, 10) + 1 : Math.min(limit, 10) + 2));
  const q = `secCodes=${sym}&reportTypes=${period === "year" ? "YEAR" : "QUARTER"}&modelTypes=${FIN_MODELS[report]}&fromDate=${from.toISOString().slice(0, 10)}&toDate=${to.toISOString().slice(0, 10)}`;
  const payload = await vndGet<{ data?: { hits?: unknown } }>(`/v3/stocks/financialStatement?${q}`, 12_000);
  const items = normalizeStatementHits(payload.data?.hits);
  if (!items.length) throw new ProviderError(`vndirect: empty ${report} financials ${sym}`, VNDIRECT);
  return pivotStatement(items).slice(0, limit);
}

/** E — ratios trực tiếp từ VNDirect (kèm itemName); rỗng → service dùng deterministic engine. */
export async function getVndRatios(symbol: string, limit = 120): Promise<VndRatioRow[]> {
  const sym = symbol.toUpperCase();
  const rows = await vndGet<{ data?: unknown }>(`/v4/ratios?q=code:${sym}&size=${Math.min(limit, 500)}`, 12_000);
  const normalized = normalizeRatioRows(rows.data);
  if (!normalized.length) throw new ProviderError(`vndirect: empty ratios ${sym}`, VNDIRECT);
  return normalized;
}

/** F — order book (top-of-book từ stock_latest; depth → UNAVAILABLE). */
export async function getVndOrderBook(symbol: string): Promise<VndOrderBook> {
  const sym = symbol.toUpperCase();
  const quote = await getVndQuoteRaw(sym);
  return normalizeOrderBook(sym, quote);
}

/** G — analyst recommendations: VNDirect finfo KHÔNG công bố → UNAVAILABLE (không bịa). */
export async function getVndRecommendation(symbol: string): Promise<{
  symbol: string;
  status: "UNAVAILABLE";
  source: "VNDIRECT";
  recommendation: null;
  buy: null;
  hold: null;
  sell: null;
  targetPrice: null;
  recommendationDate: null;
  reason: string;
}> {
  return {
    symbol: symbol.toUpperCase(),
    status: "UNAVAILABLE",
    source: "VNDIRECT",
    recommendation: null,
    buy: null,
    hold: null,
    sell: null,
    targetPrice: null,
    recommendationDate: null,
    reason: "VNDirect finfo REST không công bố dữ liệu analyst recommendation — hệ thống không tạo dữ liệu giả.",
  };
}
