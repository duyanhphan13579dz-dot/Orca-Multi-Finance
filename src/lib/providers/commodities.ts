import "server-only";
import { env } from "../env";
import { httpJson, httpText } from "../http";
import { ProviderError } from "./binance";

/**
 * Commodity data providers + aggregator.
 * Sources (priority per spec): Vietnambiz → Simplize → MSN Finance (env
 * instrument map) → Binance PAXG (gold cross-source). Every record carries
 * source + timestamp; unit/currency normalization lives here.
 */

export const VIETNAMBIZ = "vietnambiz";
export const SIMPLIZE = "simplize";
export const MSN_FINANCE = "msn-finance";
export const BINANCE_PAXG = "binance-paxg";

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
}

/* ------------------------------ catalog ----------------------------------- */

export type CommodityGroup = "metals" | "energy" | "industrial" | "agriculture" | "vietnam";

export interface CommodityDef {
  key: string;
  name: string;
  nameVi: string;
  group: CommodityGroup;
  symbol: string;
  unit: string;
  currency: string;
  msnKey?: string; // key inside MSN_COMMODITY_MAP env var
  binanceSymbol?: string;
  /** Yahoo futures/spot ticker — approved public reference source */
  yahooSymbol?: string;
  /** provider quotes in US cents (KC/SB/ZC/ZS/ZW) → normalize to USD unit */
  centsQuoted?: boolean;
  vietnambiz?: "sjc-gold"; // scrape strategy
  vnImpact?: { sector: string; stocks: string[]; mechanism: string };
}

export const COMMODITY_CATALOG: CommodityDef[] = [
  {
    key: "gold", name: "Gold", nameVi: "Vàng thế giới", group: "metals", symbol: "XAUUSD", unit: "USD/oz", currency: "USD", yahooSymbol: "GC=F",
    msnKey: "GOLD", binanceSymbol: "PAXGUSDT",
  },
  { key: "silver", name: "Silver", nameVi: "Bạc", group: "metals", symbol: "XAGUSD", unit: "USD/oz", currency: "USD", yahooSymbol: "SI=F", msnKey: "SILVER" },
  {
    key: "wti", name: "WTI Crude Oil", nameVi: "Dầu thô WTI", group: "energy", symbol: "CL", unit: "USD/bbl", currency: "USD", yahooSymbol: "CL=F", msnKey: "WTI",
    vnImpact: { sector: "Dầu khí", stocks: ["GAS", "PLX", "BSR", "PVD", "PVS"], mechanism: "Giá dầu tác động trực tiếp doanh thu khai thác, vận tải và phân phối" },
  },
  {
    key: "brent", name: "Brent Crude Oil", nameVi: "Dầu Brent", group: "energy", symbol: "BZ", unit: "USD/bbl", currency: "USD", yahooSymbol: "BZ=F", msnKey: "BRENT",
    vnImpact: { sector: "Dầu khí", stocks: ["GAS", "PLX", "BSR", "OIL"], mechanism: "Chuẩn giá dầu tham chiếu cho hợp đồng khu vực" },
  },
  { key: "natgas", name: "Natural Gas", nameVi: "Khí thiên nhiên", group: "energy", symbol: "NG", unit: "USD/MMBtu", currency: "USD", yahooSymbol: "NG=F", msnKey: "NATGAS",
    vnImpact: { sector: "Điện & Phân bón", stocks: ["GAS", "POW", "DCM", "DPM"], mechanism: "Chi phí đầu vào cho điện lực và phân bón" } },
  {
    key: "copper", name: "Copper", nameVi: "Đồng", group: "industrial", symbol: "HG", unit: "USD/lb", currency: "USD", yahooSymbol: "HG=F", msnKey: "COPPER",
    vnImpact: { sector: "Kim loại", stocks: ["HSG", "NKG", "HPG"], mechanism: "Chỉ báo chu kỳ kim loại công nghiệp" },
  },
  {
    key: "steel", name: "Steel", nameVi: "Thép", group: "industrial", symbol: "HRC", unit: "CNY/tấn", currency: "CNY", msnKey: "STEEL",
    vnImpact: { sector: "Thép", stocks: ["HPG", "HSG", "NKG", "SMC"], mechanism: "Giá thép quyết định biên lợi nhuận doanh nghiệp thép" },
  },
  {
    key: "coffee", name: "Coffee", nameVi: "Cà phê", group: "agriculture", symbol: "KC", unit: "USD/lb", currency: "USD", yahooSymbol: "KC=F", centsQuoted: true, msnKey: "COFFEE",
    vnImpact: { sector: "Nông nghiệp", stocks: ["VNM", "PAN"], mechanism: "Việt Nam là nước xuất khẩu robusta lớn thứ hai thế giới" },
  },
  { key: "sugar", name: "Sugar", nameVi: "Đường", group: "agriculture", symbol: "SB", unit: "USD/lb", currency: "USD", yahooSymbol: "SB=F", centsQuoted: true, msnKey: "SUGAR",
    vnImpact: { sector: "Nông nghiệp", stocks: ["QNS", "LSS", "SBT"], mechanism: "Giá đường thế giới chi phối giá mía đường nội địa" } },
  { key: "corn", name: "Corn", nameVi: "Ngô", group: "agriculture", symbol: "ZC", unit: "USD/bu", currency: "USD", yahooSymbol: "ZC=F", centsQuoted: true, msnKey: "CORN",
    vnImpact: { sector: "Chăn nuôi", stocks: ["DBC", "BAF", "HAG"], mechanism: "Chi phí thức ăn chăn nuôi" } },
  { key: "wheat", name: "Wheat", nameVi: "Lúa mì", group: "agriculture", symbol: "ZW", unit: "USD/bu", currency: "USD", yahooSymbol: "ZW=F", centsQuoted: true, msnKey: "WHEAT" },
  { key: "soybean", name: "Soybean", nameVi: "Đậu tương", group: "agriculture", symbol: "ZS", unit: "USD/bu", currency: "USD", yahooSymbol: "ZS=F", centsQuoted: true, msnKey: "SOYBEAN",
    vnImpact: { sector: "Chăn nuôi", stocks: ["DBC", "BAF"], mechanism: "Chi phí thức ăn chăn nuôi" } },
  {
    key: "sjc-gold", name: "SJC Gold (VN)", nameVi: "Vàng SJC", group: "vietnam", symbol: "SJC", unit: "VND/lượng", currency: "VND",
    vietnambiz: "sjc-gold",
    vnImpact: { sector: "Tài sản nội", stocks: [], mechanism: "Kênh trú ẩn tài sản trong nước, ảnh hưởng tâm lý thị trường" },
  },
];

/* -------------------------------- MSN Finance ------------------------------ */

type MsnQuote = {
  price?: number;
  priceChange?: number;
  priceChangePercent?: number;
  priceDayHigh?: number;
  priceDayLow?: number;
  timeLastTraded?: string;
  displayName?: string;
  symbol?: string;
  instrumentId?: string;
};

export async function getMsnQuotes(ids: string[]): Promise<Record<string, RawCommodityQuote>> {
  if (!ids.length) return {};
  const url = `https://assets.msn.com/service/Finance/Quotes?apikey=${env.msnApiKey}&ocid=finance-utils-peregrine&cm=en-us&it=web&wrapodata=false&ids=${ids
    .map(encodeURIComponent)
    .join(",")}`;
  const res = await httpJson<MsnQuote[]>(url, { provider: MSN_FINANCE, timeoutMs: 8_000, retries: 1 });
  if (!res.ok || !Array.isArray(res.data)) throw new ProviderError(`msn: ${res.error ?? "unreachable"}`, MSN_FINANCE);
  const out: Record<string, RawCommodityQuote> = {};
  for (const q of res.data) {
    if (!q || typeof q.price !== "number" || !q.instrumentId) continue;
    out[q.instrumentId] = {
      source: "MSN Finance",
      price: q.price,
      change: q.priceChange ?? null,
      changePercent: q.priceChangePercent ?? null,
      high: q.priceDayHigh ?? null,
      low: q.priceDayLow ?? null,
      timestamp: q.timeLastTraded ? Date.parse(q.timeLastTraded) : null,
    };
  }
  if (!Object.keys(out).length) throw new ProviderError("msn: empty payload", MSN_FINANCE);
  return out;
}

/* -------------------------------- Vietnambiz ------------------------------- */

const strip = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ");

/**
 * SJC gold price from Vietnambiz gold page (real scraped numbers).
 * Fragile by nature of scraping → returns ProviderError on any anomaly.
 */
export async function getVietnambizSjcGold(): Promise<RawCommodityQuote> {
  const url = `${env.vietnambizBaseUrl.replace(/\/$/, "")}/gia-vang-hom-nay.htm`;
  const res = await httpText(url, { provider: VIETNAMBIZ, timeoutMs: 9_000, retries: 1 });
  if (!res.ok || !res.text) throw new ProviderError(`vietnambiz: ${res.error ?? "unreachable"}`, VIETNAMBIZ);
  const text = res.text;
  const sjcIdx = text.search(/SJC/i);
  if (sjcIdx < 0) throw new ProviderError("vietnambiz: SJC row not found", VIETNAMBIZ);
  const window = strip(text.slice(sjcIdx, sjcIdx + 800));
  const numbers = (window.match(/(\d{2,3}(?:[.,]\d{3})+(?:[.,]\d)?)/g) ?? [])
    .map((n) => Number(n.replace(/\./g, "").replace(",", ".")))
    .filter((n) => Number.isFinite(n) && n > 10_000); // VND nghìn/lượng sanity window
  if (numbers.length < 2) throw new ProviderError("vietnambiz: price parse failed", VIETNAMBIZ);
  const buy = numbers[0];
  const sell = numbers[1];
  const mid = (buy + sell) / 2;
  // Vietnambiz quotes SJC in "nghìn đồng/lượng" on this board → normalize to VND/lượng
  const priceVnd = mid < 100_000 ? mid * 1000 : mid;
  const dateMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{4})(?:\s+(\d{1,2}:\d{2}))?/);
  const ts = dateMatch ? Date.parse(dateMatch[0].replace(/(\d{1,2})\/(\d{1,2})\/(\d{4})/, "$3-$2-$1")) : null;
  return {
    source: "Vietnambiz",
    price: priceVnd,
    change: null,
    changePercent: null,
    unit: "VND/lượng",
    currency: "VND",
    timestamp: Number.isFinite(ts) ? ts : null,
    url,
  };
}

/* --------------------------------- Simplize -------------------------------- */

/** Simplize commodity board — requires SIMPLIZE_API_KEY + reachable contract. */
export async function getSimplizeCommodity(key: string): Promise<RawCommodityQuote> {
  if (!env.simplizeApiKey) throw new ProviderError("SIMPLIZE_API_KEY not configured", SIMPLIZE);
  const path = process.env.SIMPLIZE_COMMODITY_PATH ?? "/api/commodity/price/current";
  const res = await httpJson<unknown>(`${env.simplizeBaseUrl.replace(/\/$/, "")}${path}?ticker=${encodeURIComponent(key)}`, {
    provider: SIMPLIZE,
    headers: { Authorization: `Bearer ${env.simplizeApiKey}`, "x-api-key": env.simplizeApiKey },
    timeoutMs: 8_000,
    retries: 1,
  });
  if (!res.ok || res.data == null) throw new ProviderError(`simplize: ${res.error ?? "unreachable"}`, SIMPLIZE);
  const d = res.data as Record<string, unknown>;
  const price = Number(d.price ?? d.close ?? d.value);
  if (!Number.isFinite(price)) throw new ProviderError("simplize: no price field", SIMPLIZE);
  const tsRaw = d.timestamp ?? d.time ?? d.updatedAt;
  const ts = typeof tsRaw === "number" ? (tsRaw > 1e12 ? tsRaw : tsRaw * 1000) : Date.parse(String(tsRaw ?? ""));
  return {
    source: "Simplize",
    price,
    change: d.change != null ? Number(d.change) : null,
    changePercent: d.changePercent != null ? Number(d.changePercent) : null,
    timestamp: Number.isFinite(ts) ? ts : null,
  };
}
