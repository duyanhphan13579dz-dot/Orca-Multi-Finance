import "server-only";
import type { ImpactDirection, ImpactStrength, RelationshipType } from "../engines/commodity";

/**
 * Commodity catalog — NGUỒN DUY NHẤT: VietnamBiz Data portal (WiFeed/WiGroup).
 *
 * 2026-09-06 (user directive): chuyển TOÀN BỘ hàng hóa về
 * `https://data.vietnambiz.vn/goods` — Simplize/MSN/Binance/Yahoo ĐÃ BỎ hoàn toàn
 * (kể cả chart OHLC lịch sử). Catalog không còn ticker nguồn ngoài.
 * Mỗi mục dưới đây tương ứng ĐÚNG 1 dòng trong bảng /goods (name + unit lấy
 * nguyên văn từ trang). Không quy đổi tiền tệ; SJC là ngoại lệ: trang ghi
 * "Đồng/lượng" nhưng giá 147,600 là NGHÌN đồng/lượng (đối chiếu SJC ~145–150
 * triệu đồng/lượng) → ×1000 có chú thích.
 */

/* ------------------------------ types ----------------------------------- */

export interface RawCommodityQuote {
  source: string;
  price: number;
  change?: number | null;
  changePercent?: number | null;
  previousClose?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  unit?: string | null;
  currency?: string | null;
  /** provider-published performance (NOT hard-coded) */
  perf?: Partial<Record<"1W" | "1M" | "3M" | "YTD" | "1Y" | "5Y", number>>;
  relatedStocks?: string[];
  /** provider-published source timestamp (millis) */
  timestamp: number | null;
  url?: string | null;
}

export type CommodityGroup = "consumer" | "metals" | "chemicals" | "construction" | "energy" | "plastics";

export type CommodityCategory =
  | "consumer"
  | "metals"
  | "chemicals"
  | "construction"
  | "energy"
  | "plastics"
  | "other";

export type CommodityMarket = "VN" | "INTL";

export interface CommodityRelation {
  relationshipType: RelationshipType;
  direction: ImpactDirection;
  impactStrength: ImpactStrength;
  confidence?: "HIGH" | "MEDIUM" | "LOW";
  channel?: string;
}

export interface CommodityImpactMap {
  sector: string;
  stocks: string[];
  mechanism: string;
  relations?: Record<string, CommodityRelation>;
}

export interface CommodityDef {
  key: string;
  name: string;
  nameVi: string;
  group: CommodityGroup;
  category: CommodityCategory;
  subcategory?: string;
  subgroup?: string;
  market: CommodityMarket;
  symbol: string;
  unit: string;
  currency: string;
  /** giá trị WiFeed → đơn vị catalog (mặc định 1; chỉ SJC ×1000 — xem header) */
  valueScale?: number;
  /** news-filter keywords cho NEWS & CATALYST engine */
  newsKeywords?: string[];
  /** evidence-based economic exposure (curated; optional) */
  vnImpact?: CommodityImpactMap;
}

/* ----------------------------- catalog (66 rows) -------------------------- */
/* Mỗi dòng: [key, nameVi (row name trên /goods), group, symbol, unit] */

type Row = [key: string, nameVi: string, group: CommodityGroup, symbol: string, unit: string];

const ROWS: Row[] = [
  // ---- Hàng tiêu dùng (15) ----
  ["pig-vn", "Giá heo hơi trong nước", "consumer", "PIGVN", "Đồng/kg"],
  ["cotton-fabric-cn", "Vải cotton Trung Quốc", "consumer", "COFTCN", "CNY/tấn"],
  ["cotton-yarn-cn", "Sợi cotton Trung Quốc", "consumer", "COTYCN", "CNY/tấn"],
  ["palm-oil", "Dầu cọ Malaysia", "consumer", "PALM", "MYR/tấn"],
  ["kraft-paper", "Giấy gợn sóng Trung Quốc", "consumer", "PAPER", "CNY/tấn"],
  ["sugar", "Đường", "consumer", "SUG", "USD/tấn"],
  ["coffee", "Cà phê", "consumer", "COF", "USD/tấn"],
  ["coffee-robusta", "Giá cà phê trong nước", "consumer", "COFVN", "Đồng/kg"],
  ["pepper", "Hồ tiêu", "consumer", "PEP", "Đồng/kg"],
  ["cotton-fabric-us", "Vải cotton Mỹ", "consumer", "COFTUS", "USD/tấn"],
  ["rice", "Gạo TPXK", "consumer", "RICE", "Đồng/kg"],
  ["shrimp-vn", "Tôm thẻ", "consumer", "TOMTHE", "Đồng/kg"],
  ["paddy", "Lúa", "consumer", "PADDY", "Đồng/kg"],
  ["rice-raw", "Gạo nguyên liệu", "consumer", "RICERAW", "Đồng/kg"],
  ["rice-byproduct", "Phụ phẩm lúa gạo", "consumer", "RICEBP", "Đồng/kg"],
  // ---- Kim loại và phi kim (10) ----
  ["iron-ore", "Quặng sắt Trung Quốc", "metals", "IO", "CNY/tấn"],
  ["lead", "Chì Trung Quốc", "metals", "PB", "CNY/tấn"],
  ["zinc", "Kẽm Trung Quốc", "metals", "ZN", "CNY/tấn"],
  ["aluminum", "Nhôm Trung Quốc", "metals", "AL", "CNY/tấn"],
  ["copper-cn", "Đồng Trung Quốc", "metals", "CUCN", "CNY/tấn"],
  ["nickel", "Nikken Trung Quốc", "metals", "NI", "CNY/tấn"],
  ["gold", "Giá vàng", "metals", "GOLD", "USD/ounce"],
  ["sjc-gold", "Giá vàng trong nước", "metals", "SJC", "Đồng/lượng"],
  ["silver", "Giá bạc", "metals", "AG", "USD/ounce"],
  ["copper", "Giá đồng", "metals", "CU", "USD/pound"],
  // ---- Hóa chất (7) ----
  ["urea", "Ure Trung Đông", "chemicals", "URE", "USD/tấn"],
  ["sulfur", "Lưu huỳnh Trung Quốc", "chemicals", "SULF", "CNY/tấn"],
  ["yellow-phosphorus", "Phốt pho vàng Trung Quốc", "chemicals", "P4", "CNY/tấn"],
  ["caustic-soda", "Xút (NaOH) Trung Quốc", "chemicals", "NAOH", "CNY/tấn"],
  ["urea-cn", "Phân Urea Trung Quốc", "chemicals", "URECN", "CNY/tấn"],
  ["urea-phu-my", "Phân Ure Phú Mỹ", "chemicals", "UREPM", "Đồng/kg"],
  ["urea-ca-mau", "Phân Ure Cà Mau", "chemicals", "URECM", "Đồng/kg"],
  // ---- Vật liệu xây dựng (20) ----
  ["steel-scrap", "Thép phế Anh", "construction", "SCRAP", "USD/tấn"],
  ["steel-rebar", "Thép thanh Anh", "construction", "REBAR", "USD/tấn"],
  ["steel", "HRC Trung Quốc", "construction", "HRC", "CNY/tấn"],
  ["aggregate-04", "Đá 0-4", "construction", "AGG04", "Đồng/m3"],
  ["aggregate-sieve", "Đá mi sàng", "construction", "AGGSV", "Đồng/m3"],
  ["aggregate-1x2", "Đá 1x2", "construction", "AGG12", "Đồng/m3"],
  ["aggregate-boulder", "Đá Hộc", "construction", "AGGHC", "Đồng/m3"],
  ["sheet-color", "Tôn lạnh màu Hoa Sen 0,45mm", "construction", "SHEETC", "Đồng/m2"],
  ["sheet", "Tôn lạnh Hoa Sen 0,45mm", "construction", "SHEET", "Đồng/m2"],
  ["asphalt", "Bê tông nhựa mịn : Carboncor Asphalt - CA 9.5", "construction", "ASPH", "Đồng/tấn"],
  ["pipe-27", "Ống nhựa 27 x 1.8mm", "construction", "P27", "Đồng/m"],
  ["pipe-60", "Ống nhựa 60 x 2mm", "construction", "P60", "Đồng/m"],
  ["pipe-90", "Ống nhựa 90 x 2,9mm", "construction", "P90", "Đồng/m"],
  ["paint-primer", "Sơn lót kháng kiềm cao cấp", "construction", "PPRIM", "Đồng/lít"],
  ["paint-interior", "Sơn nội thất tiêu chuẩn STANDARD", "construction", "PINT", "Đồng/lít"],
  ["paint-exterior", "Sơn ngoại thất STANDARD", "construction", "PEXT", "Đồng/lít"],
  ["cement", "Xi măng - Vicem Hà Tiên PCB 40 - bao 50kg", "construction", "CEM", "Đồng/kg"],
  ["concrete", "Bê tông thương phẩm - Mác 300", "construction", "CONC", "Đồng/m3"],
  ["brick", "Gạch đất sét nung - Gạch ống 4 lỗ 80x80x80", "construction", "BRICK", "Đồng/viên"],
  ["pile", "Cọc bê tông dự ứng lực - Cọc 30x30cm, L=18m", "construction", "PILE", "Đồng/cọc"],
  // ---- Năng lượng (10) ----
  ["coal", "Than cốc Trung Quốc", "energy", "COAL", "CNY/tấn"],
  ["lpg", "Khí LPG Trung Quốc", "energy", "LPG", "CNY/tấn"],
  ["wti", "Dầu WTI", "energy", "WTI", "USD/thùng"],
  ["natgas", "Khí thiên nhiên", "energy", "NG", "USD/Mmbtu"],
  ["coal-newcastle", "Than Newcastle", "energy", "NC", "USD/tấn"],
  ["gasoline-95-v", "Xăng RON 95-V", "energy", "G95V", "Nghìn/lít"],
  ["gasoline-95", "Xăng RON 95-II,III", "energy", "G95", "Nghìn/lít"],
  ["gasoline-92", "Xăng sinh học E5 RON 92-II", "energy", "G92", "Nghìn/lít"],
  ["diesel", "Xăng Diezen", "energy", "DO", "Nghìn/lít"],
  ["kerosene", "Dầu hoả", "energy", "KERO", "Nghìn/lít"],
  // ---- Nhựa và cao su (4) ----
  ["rubber", "Cao su Nhật Bản", "plastics", "RUB", "Yên/tấn"],
  ["pet", "PET Trung Quốc", "plastics", "PET", "CNY/tấn"],
  ["pvc", "Hạt nhựa PVC Trung Quốc", "plastics", "PVC", "CNY/tấn"],
  ["pp", "Hạt nhựa PP Trung Quốc", "plastics", "PP", "CNY/tấn"],
];

const GROUP_LABEL: Record<CommodityGroup, string> = {
  consumer: "Hàng tiêu dùng",
  metals: "Kim loại và phi kim",
  chemicals: "Hóa chất",
  construction: "Vật liệu xây dựng",
  energy: "Năng lượng",
  plastics: "Nhựa và cao su",
};

/** Chinese-currency rows → per unit mapping; VND rows → VN market. */
export function currencyForUnit(unit: string | null | undefined): string {
  const u = (unit ?? "").toUpperCase();
  if (/VNĐ|VND|ĐỒNG|NGHÌN/.test(u)) return "VND";
  if (/CNY/.test(u)) return "CNY";
  if (/MYR/.test(u)) return "MYR";
  if (/JPY|YÊN/.test(u)) return "JPY";
  return "USD";
}

/** vnImpact curated cho các mục đã có (kinh tế VN) — giữ nguyên từ catalog cũ. */
const VN_IMPACT: Record<string, CommodityImpactMap> = {
  "sjc-gold": {
    sector: "Vàng bạc đá quý & Ngân hàng", stocks: ["PNJ", "SJC", "VCB", "BID"],
    mechanism: "Giá vàng trong nước phản ánh cung cầu vàng miếng SJC; tăng → doanh thu bán lẻ vàng tăng, nhu cầu trú ẩn tăng",
    relations: {
      PNJ: { relationshipType: "REVENUE_DRIVER", direction: "POSITIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Doanh thu bán vàng miếng/nữ trang theo giá thị trường" },
    },
  },
  "pig-vn": {
    sector: "Chăn nuôi & Thực phẩm", stocks: ["DBC", "BAF", "HAG", "MML"],
    mechanism: "Giá heo hơi tăng → doanh thu trang trại tăng; chi phí đầu vào chế biến thực phẩm tăng",
    relations: {
      DBC: { relationshipType: "REVENUE_DRIVER", direction: "POSITIVE", impactStrength: "HIGH", confidence: "MEDIUM", channel: "Giá bán heo hơi tăng trực tiếp vào doanh thu trang trại" },
      BAF: { relationshipType: "REVENUE_DRIVER", direction: "POSITIVE", impactStrength: "HIGH", confidence: "MEDIUM", channel: "Giá bán heo hơi tăng trực tiếp vào doanh thu trang trại" },
    },
  },
  gasoline: {
    sector: "Dầu khí & Vận tải", stocks: ["PLX", "OIL", "VIP", "VTO", "GMD"],
    mechanism: "Giá xăng điều hành theo giá dầu thế giới; tăng → doanh thu bán lẻ tăng, chi phí vận tải/logistics tăng",
    relations: {
      PLX: { relationshipType: "SELLING_PRICE", direction: "POSITIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Giá bán điều hành theo chi phí → doanh thu bán lẻ tăng" },
      VIP: { relationshipType: "INPUT_COST", direction: "NEGATIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Chi phí vận tải xăng dầu tăng" },
      GMD: { relationshipType: "INPUT_COST", direction: "NEGATIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Chi phí nhiên liệu logistics tăng" },
    },
  },
  diesel: {
    sector: "Vận tải & Logistics", stocks: ["GMD", "VTO", "VIP", "PLX", "OIL"],
    mechanism: "Giá diesel là chi phí đầu vào trực tiếp của vận tải/logistics; tăng → chi phí vận tải tăng",
    relations: {
      GMD: { relationshipType: "INPUT_COST", direction: "NEGATIVE", impactStrength: "HIGH", confidence: "MEDIUM", channel: "Nhiên liệu là chi phí vận hành chính của cảng/logistics" },
      VTO: { relationshipType: "INPUT_COST", direction: "NEGATIVE", impactStrength: "HIGH", confidence: "MEDIUM", channel: "Vận tải xăng dầu tiêu hao diesel lớn" },
      PLX: { relationshipType: "SELLING_PRICE", direction: "POSITIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Giá bán điều hành theo chi phí → doanh thu bán lẻ tăng" },
    },
  },
  wti: {
    sector: "Dầu khí & Vận tải", stocks: ["GAS", "PLX", "BSR", "PVD", "PVS"],
    mechanism: "Giá dầu WTI là chuẩn giá dầu thế giới; tăng → doanh thu thương mại dầu khí, chi phí nhiên liệu vận tải tăng",
    relations: {
      PLX: { relationshipType: "SELLING_PRICE", direction: "POSITIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Giá bán lẻ điều hành theo giá dầu thế giới" },
      BSR: { relationshipType: "INPUT_COST", direction: "NEGATIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Chi phí dầu thô đầu vào lọc dầu tăng" },
    },
  },
  steel: {
    sector: "Thép", stocks: ["HPG", "HSG", "NKG"],
    mechanism: "Giá HRC Trung Quốc là chuẩn thép cuộn; tăng → giá bán thép nội địa tăng, chi phí nguyên liệu nhập khẩu tăng",
    relations: {
      HPG: { relationshipType: "SELLING_PRICE", direction: "POSITIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Giá thép nội địa bám theo giá HRC Trung Quốc" },
      HSG: { relationshipType: "INPUT_COST", direction: "NEGATIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Chi phí HRC nhập khẩu tăng" },
    },
  },
  iron: {
    sector: "Thép", stocks: ["HPG", "HSG", "NKG"],
    mechanism: "Giá quặng sắt là chi phí đầu vào chính luyện thép; tăng → chi phí sản xuất thép tăng",
    relations: {
      HPG: { relationshipType: "INPUT_COST", direction: "NEGATIVE", impactStrength: "HIGH", confidence: "MEDIUM", channel: "Quặng sắt chiếm tỷ trọng lớn giá thành thép" },
    },
  },
  urea: {
    sector: "Phân bón", stocks: ["DCM", "DPM", "SFG", "LAS"],
    mechanism: "Giá ure nhập khẩu (Trung Đông) quyết định giá thành phân bón nội địa; tăng → giá bán phân bón trong nước tăng",
    relations: {
      DCM: { relationshipType: "SELLING_PRICE", direction: "POSITIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Giá ure thế giới tăng → giá bán ure nội địa tăng" },
      DPM: { relationshipType: "SELLING_PRICE", direction: "POSITIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Giá ure thế giới tăng → giá bán ure nội địa tăng" },
    },
  },
  rice: {
    sector: "Nông sản xuất khẩu", stocks: ["LTG", "VHC", "ANV"],
    mechanism: "Giá gạo xuất khẩu tăng → doanh thu các doanh nghiệp xuất khẩu gạo và thủy sản liên quan tăng",
    relations: {
      LTG: { relationshipType: "REVENUE_DRIVER", direction: "POSITIVE", impactStrength: "HIGH", confidence: "MEDIUM", channel: "Giá gạo TPXK tăng trực tiếp vào doanh thu xuất khẩu" },
    },
  },
  shrimp: {
    sector: "Thủy sản", stocks: ["FMC", "ABT", "CMX"],
    mechanism: "Giá tôm thẻ nguyên liệu tăng → chi phí chế biến thủy sản tăng, giá xuất khẩu tăng",
    relations: {
      FMC: { relationshipType: "INPUT_COST", direction: "NEGATIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Nguyên liệu tôm là chi phí chính của chế biến xuất khẩu" },
    },
  },
};

const KEYS = new Set<string>();
const SYMBOLS = new Set<string>();
export const COMMODITY_CATALOG: CommodityDef[] = ROWS.map(([key, nameVi, group, symbol, unit]) => {
  if (KEYS.has(key)) throw new Error(`duplicate commodity key: ${key}`);
  if (SYMBOLS.has(symbol)) throw new Error(`duplicate symbol: ${symbol}`);
  KEYS.add(key);
  SYMBOLS.add(symbol);
  const currency = currencyForUnit(unit);
  const impact =
    VN_IMPACT[key] ??
    (key === "gasoline-95" || key === "gasoline-92" || key === "gasoline-95-v" ? VN_IMPACT.gasoline : undefined) ??
    (key === "iron-ore" ? VN_IMPACT.iron : undefined) ??
    (key === "shrimp-vn" ? VN_IMPACT.shrimp : undefined);
  return {
    key,
    name: nameVi,
    nameVi,
    group,
    category: group,
    subcategory: GROUP_LABEL[group],
    subgroup: GROUP_LABEL[group],
    market: currency === "VND" ? "VN" : "INTL",
    symbol,
    unit,
    currency,
    valueScale: key === "sjc-gold" ? 1000 : undefined, // trang ghi nghìn đồng/lượng với nhãn "Đồng/lượng"
    vnImpact: impact,
  };
});

export function defByKeyOrSymbol(needle: string): CommodityDef | null {
  const q = needle.toUpperCase();
  return COMMODITY_CATALOG.find((d) => d.key.toUpperCase() === q || d.symbol.toUpperCase() === q) ?? null;
}

/* ------------------------------ number utils ------------------------------ */

/** "1,226" → 1226; "15.87" → 15.87; "+ 0.18" → 0.18 (thousands sep = ",", "." = decimal) */
export function parseDecimal(s: string): number {
  const v = Number(s.replace(/,/g, "").replace(/\s+/g, "").trim());
  return Number.isFinite(v) ? v : NaN;
}
