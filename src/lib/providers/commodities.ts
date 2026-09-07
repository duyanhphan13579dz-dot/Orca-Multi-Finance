import "server-only";
import { httpText } from "../http";
import { ProviderError } from "./binance";

/**
 * Commodity data — VietnamBiz ONLY.
 * All quotes scraped from vietnambiz.vn price boards (Hàng hóa).
 * No MSN / Yahoo / Binance / Simplize fallbacks.
 */

export const VIETNAMBIZ = "vietnambiz";

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

export type CommodityGroup = "metals" | "energy" | "industrial" | "agriculture" | "vietnam";

export interface CommodityDef {
  key: string;
  name: string;
  nameVi: string;
  group: CommodityGroup;
  symbol: string;
  unit: string;
  currency: string;
  /** path on vietnambiz.vn, e.g. gia-vang-hom-nay.html */
  vnbPath: string;
  /** parser strategy */
  parse: VnbParseKind;
  vnImpact?: { sector: string; stocks: string[]; mechanism: string };
}

export type VnbParseKind =
  | "sjc-gold"
  | "coffee-vn"
  | "fuel-ron95"
  | "fuel-e5"
  | "fuel-diesel"
  | "gas-12kg"
  | "rubber"
  | "pig"
  | "pepper"
  | "steel";

/**
 * Catalog mirrored to VietnamBiz boards that actually publish prices.
 * World futures (WTI/Brent/copper…) are NOT listed — no VietnamBiz primary board.
 */
export const COMMODITY_CATALOG: CommodityDef[] = [
  {
    key: "sjc-gold",
    name: "SJC Gold",
    nameVi: "Vàng SJC",
    group: "vietnam",
    symbol: "SJC",
    unit: "VND/lượng",
    currency: "VND",
    vnbPath: "gia-vang-hom-nay.html",
    parse: "sjc-gold",
    vnImpact: { sector: "Tài sản nội", stocks: [], mechanism: "Kênh trú ẩn tài sản trong nước" },
  },
  {
    key: "coffee",
    name: "Coffee (VN robusta)",
    nameVi: "Cà phê nhân xô",
    group: "agriculture",
    symbol: "CFVN",
    unit: "VND/kg",
    currency: "VND",
    vnbPath: "gia-ca-phe-hom-nay.html",
    parse: "coffee-vn",
    vnImpact: {
      sector: "Nông nghiệp",
      stocks: ["VNM", "PAN"],
      mechanism: "Việt Nam xuất khẩu robusta hàng đầu thế giới",
    },
  },
  {
    key: "pepper",
    name: "Black pepper",
    nameVi: "Hồ tiêu",
    group: "agriculture",
    symbol: "PEPPER",
    unit: "VND/kg",
    currency: "VND",
    vnbPath: "gia-tieu-hom-nay.html",
    parse: "pepper",
    vnImpact: { sector: "Nông nghiệp", stocks: [], mechanism: "Xuất khẩu hồ tiêu Việt Nam" },
  },
  {
    key: "rubber",
    name: "Natural rubber",
    nameVi: "Cao su",
    group: "agriculture",
    symbol: "RUBBER",
    unit: "VND/kg",
    currency: "VND",
    vnbPath: "gia-cao-su-hom-nay.html",
    parse: "rubber",
    vnImpact: { sector: "Cao su", stocks: ["GVR", "PHR", "DPR"], mechanism: "Giá mủ ảnh hưởng doanh thu cao su" },
  },
  {
    key: "pig",
    name: "Live hog",
    nameVi: "Heo hơi",
    group: "agriculture",
    symbol: "HOG",
    unit: "VND/kg",
    currency: "VND",
    vnbPath: "gia-heo-hoi-hom-nay.html",
    parse: "pig",
    vnImpact: { sector: "Chăn nuôi", stocks: ["DBC", "BAF", "HAG"], mechanism: "Giá heo hơi quyết định biên lợi nhuận chăn nuôi" },
  },
  {
    key: "ron95",
    name: "Gasoline RON95",
    nameVi: "Xăng RON95",
    group: "energy",
    symbol: "RON95",
    unit: "VND/lít",
    currency: "VND",
    vnbPath: "gia-xang-dau-hom-nay.html",
    parse: "fuel-ron95",
    vnImpact: { sector: "Xăng dầu", stocks: ["PLX", "OIL"], mechanism: "Giá bán lẻ điều hành Liên bộ" },
  },
  {
    key: "e5",
    name: "Gasoline E5 RON92",
    nameVi: "Xăng E5 RON92",
    group: "energy",
    symbol: "E5",
    unit: "VND/lít",
    currency: "VND",
    vnbPath: "gia-xang-dau-hom-nay.html",
    parse: "fuel-e5",
  },
  {
    key: "diesel",
    name: "Diesel 0.05S",
    nameVi: "Dầu diesel",
    group: "energy",
    symbol: "DO",
    unit: "VND/lít",
    currency: "VND",
    vnbPath: "gia-xang-dau-hom-nay.html",
    parse: "fuel-diesel",
  },
  {
    key: "gas-lpg",
    name: "LPG 12kg",
    nameVi: "Gas bình 12kg",
    group: "energy",
    symbol: "LPG12",
    unit: "VND/bình",
    currency: "VND",
    vnbPath: "gia-gas-hom-nay.html",
    parse: "gas-12kg",
  },
  {
    key: "steel",
    name: "Steel (VN)",
    nameVi: "Sắt thép",
    group: "industrial",
    symbol: "STEEL",
    unit: "VND/kg",
    currency: "VND",
    vnbPath: "gia-thep-hom-nay.html",
    parse: "steel",
    vnImpact: { sector: "Thép", stocks: ["HPG", "HSG", "NKG"], mechanism: "Giá thép nội địa" },
  },
];

const strip = (s: string) =>
  s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&amp;|&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ");

function parseViNumber(raw: string): number | null {
  const s = raw.replace(/\s/g, "");
  if (/^\d{1,3}[.,]\d{3}$/.test(s)) {
    return Number(s.replace(/[.,]/g, ""));
  }
  if (/^\d{1,3}[.,]\d{1,2}$/.test(s)) {
    return Number(s.replace(",", "."));
  }
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function extractTimestamp(text: string): number | null {
  const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}${m[4] ? `T${m[4].padStart(2, "0")}:${m[5]}:00+07:00` : ""}`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

async function fetchPage(path: string): Promise<{ text: string; url: string }> {
  const base = (process.env.VIETNAMBIZ_BASE_URL ?? "https://vietnambiz.vn").replace(/\/$/, "");
  const url = `${base}/${path.replace(/^\//, "")}`;
  const res = await httpText(url, { provider: VIETNAMBIZ, timeoutMs: 12_000, retries: 1 });
  if (!res.ok || !res.text || res.text.length < 5_000) {
    throw new ProviderError(`vietnambiz: ${path} unreachable or empty`, VIETNAMBIZ);
  }
  return { text: strip(res.text), url };
}

function pickRange(text: string, re: RegExp): { lo: number; hi: number } | null {
  const m = text.match(re);
  if (!m) return null;
  const a = parseViNumber(m[1]);
  const b = m[2] ? parseViNumber(m[2]) : a;
  if (a == null || b == null) return null;
  return { lo: Math.min(a, b), hi: Math.max(a, b) };
}

export async function scrapeVietnambiz(def: CommodityDef): Promise<RawCommodityQuote> {
  const { text, url } = await fetchPage(def.vnbPath);
  const ts = extractTimestamp(text);

  switch (def.parse) {
    case "sjc-gold": {
      const sjcIdx = text.search(/SJC/i);
      if (sjcIdx < 0) throw new ProviderError("vietnambiz: SJC not found", VIETNAMBIZ);
      const window = text.slice(sjcIdx, sjcIdx + 1200);
      const nums = (window.match(/\d{2,3}[.,]\d{2,3}/g) ?? [])
        .map((n) => parseViNumber(n))
        .filter((n): n is number => n != null && n > 50 && n < 500);
      let buy: number | null = null;
      let sell: number | null = null;
      if (nums.length >= 2) {
        buy = nums[0];
        sell = nums[1];
      }
      if (buy == null) {
        const big = (window.match(/\d{2,3}(?:[.,]\d{3}){2,}/g) ?? [])
          .map((n) => parseViNumber(n))
          .filter((n): n is number => n != null && n > 50_000_000);
        if (big.length >= 2) {
          buy = big[0] / 1_000_000;
          sell = big[1] / 1_000_000;
        }
      }
      if (buy == null || sell == null) throw new ProviderError("vietnambiz: SJC parse failed", VIETNAMBIZ);
      const midTrieu = (buy + sell) / 2;
      const priceVnd = midTrieu * 1_000_000;
      return {
        source: "VietnamBiz",
        price: priceVnd,
        change: null,
        changePercent: null,
        high: sell * 1_000_000,
        low: buy * 1_000_000,
        unit: "VND/lượng",
        currency: "VND",
        timestamp: ts,
        url,
        note: `Mua ${buy.toFixed(2)} — Bán ${sell.toFixed(2)} triệu đồng/lượng`,
      };
    }
    case "coffee-vn": {
      const range = pickRange(text, /(\d{2,3}[.,]\d{3})\s*[–\-]\s*(\d{2,3}[.,]\d{3})\s*đồng/i);
      let price: number | null = null;
      if (range) price = (range.lo + range.hi) / 2;
      if (price == null) {
        const m = text.match(/Đắk\s*Lắk[^0-9]{0,20}(\d{2,3}[.,]\d{3})/i);
        if (m) price = parseViNumber(m[1]);
      }
      if (price == null) {
        const m = text.match(/(\d{2,3}[.,]\d{3})\s*đồng\/kg/i);
        if (m) price = parseViNumber(m[1]);
      }
      if (price == null || price < 20_000 || price > 300_000) {
        throw new ProviderError("vietnambiz: coffee parse failed", VIETNAMBIZ);
      }
      return {
        source: "VietnamBiz",
        price,
        unit: "VND/kg",
        currency: "VND",
        timestamp: ts,
        url,
        note: "Cà phê nhân xô Tây Nguyên (trung bình khu vực)",
      };
    }
    case "pepper": {
      const m = text.match(/(\d{2,3}[.,]\d{3})\s*(?:[-–]\s*(\d{2,3}[.,]\d{3})\s*)?đồng\/kg/i);
      let price: number | null = null;
      if (m) {
        const a = parseViNumber(m[1]);
        const b = m[2] ? parseViNumber(m[2]) : a;
        if (a != null && b != null) price = (a + b) / 2;
      }
      if (price == null || price < 50_000 || price > 500_000) {
        throw new ProviderError("vietnambiz: pepper parse failed", VIETNAMBIZ);
      }
      return { source: "VietnamBiz", price, unit: "VND/kg", currency: "VND", timestamp: ts, url };
    }
    case "rubber": {
      const m = text.match(/(\d{1,3}[.,]\d{3})\s*(?:[-–]\s*(\d{1,3}[.,]\d{3})\s*)?đồng\/kg/i);
      let price: number | null = null;
      if (m) {
        const a = parseViNumber(m[1]);
        const b = m[2] ? parseViNumber(m[2]) : a;
        if (a != null && b != null) price = (a + b) / 2;
      }
      if (price == null || price < 10_000 || price > 200_000) {
        throw new ProviderError("vietnambiz: rubber parse failed", VIETNAMBIZ);
      }
      return { source: "VietnamBiz", price, unit: "VND/kg", currency: "VND", timestamp: ts, url };
    }
    case "pig": {
      const m = text.match(/(\d{2,3}[.,]\d{3})\s*(?:[-–]\s*(\d{2,3}[.,]\d{3})\s*)?đồng\/kg/i);
      let price: number | null = null;
      if (m) {
        const a = parseViNumber(m[1]);
        const b = m[2] ? parseViNumber(m[2]) : a;
        if (a != null && b != null) price = (a + b) / 2;
      }
      if (price == null || price < 30_000 || price > 150_000) {
        throw new ProviderError("vietnambiz: pig parse failed", VIETNAMBIZ);
      }
      return { source: "VietnamBiz", price, unit: "VND/kg", currency: "VND", timestamp: ts, url };
    }
    case "fuel-ron95": {
      const m =
        text.match(/RON\s*95[^0-9]{0,40}(\d{2}[.,]\d{3})/i) ||
        text.match(/Xăng\s*RON\s*95[^0-9]{0,40}(\d{2}[.,]\d{3})/i);
      const price = m ? parseViNumber(m[1]) : null;
      if (price == null || price < 10_000 || price > 50_000) {
        throw new ProviderError("vietnambiz: RON95 parse failed", VIETNAMBIZ);
      }
      return { source: "VietnamBiz", price, unit: "VND/lít", currency: "VND", timestamp: ts, url };
    }
    case "fuel-e5": {
      const m = text.match(/E5[^0-9]{0,40}(\d{2}[.,]\d{3})/i);
      const price = m ? parseViNumber(m[1]) : null;
      if (price == null || price < 10_000 || price > 50_000) {
        throw new ProviderError("vietnambiz: E5 parse failed", VIETNAMBIZ);
      }
      return { source: "VietnamBiz", price, unit: "VND/lít", currency: "VND", timestamp: ts, url };
    }
    case "fuel-diesel": {
      const m =
        text.match(/Diesel[^0-9]{0,40}(\d{2}[.,]\d{3})/i) ||
        text.match(/DO\s*0[,.]05S[^0-9]{0,40}(\d{2}[.,]\d{3})/i) ||
        text.match(/Dầu\s*DO[^0-9]{0,40}(\d{2}[.,]\d{3})/i);
      const price = m ? parseViNumber(m[1]) : null;
      if (price == null || price < 10_000 || price > 50_000) {
        throw new ProviderError("vietnambiz: diesel parse failed", VIETNAMBIZ);
      }
      return { source: "VietnamBiz", price, unit: "VND/lít", currency: "VND", timestamp: ts, url };
    }
    case "gas-12kg": {
      const range = pickRange(text, /(\d{3}[.,]\d{3})\s*[-–]\s*(\d{3}[.,]\d{3})\s*đồng/i);
      let price: number | null = range ? (range.lo + range.hi) / 2 : null;
      if (price == null) {
        const m = text.match(/12\s*kg[^0-9]{0,40}(\d{3}[.,]\d{3})/i);
        if (m) price = parseViNumber(m[1]);
      }
      if (price == null || price < 200_000 || price > 1_000_000) {
        throw new ProviderError("vietnambiz: gas parse failed", VIETNAMBIZ);
      }
      return { source: "VietnamBiz", price, unit: "VND/bình 12kg", currency: "VND", timestamp: ts, url };
    }
    case "steel": {
      const m = text.match(/(\d{1,3}[.,]\d{3})\s*(?:[-–]\s*(\d{1,3}[.,]\d{3})\s*)?đồng\/kg/i);
      let price: number | null = null;
      if (m) {
        const a = parseViNumber(m[1]);
        const b = m[2] ? parseViNumber(m[2]) : a;
        if (a != null && b != null) price = (a + b) / 2;
      }
      if (price == null || price < 5_000 || price > 80_000) {
        throw new ProviderError("vietnambiz: steel parse failed", VIETNAMBIZ);
      }
      return { source: "VietnamBiz", price, unit: "VND/kg", currency: "VND", timestamp: ts, url };
    }
    default:
      throw new ProviderError(`vietnambiz: unknown parse`, VIETNAMBIZ);
  }
}

/** @deprecated use scrapeVietnambiz */
export async function getVietnambizSjcGold(): Promise<RawCommodityQuote> {
  const def = COMMODITY_CATALOG.find((d) => d.key === "sjc-gold");
  if (!def) throw new ProviderError("catalog missing sjc-gold", VIETNAMBIZ);
  return scrapeVietnambiz(def);
}
