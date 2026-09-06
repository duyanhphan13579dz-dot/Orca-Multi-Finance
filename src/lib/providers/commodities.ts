import "server-only";
import { env } from "../env";
import { httpJson, httpText } from "../http";
import { ProviderError } from "./binance";
import type { ImpactDirection, ImpactStrength, RelationshipType } from "../engines/commodity";

/**
 * Commodity data providers — REAL public sources only.
 *
 * Priority per product requirement: Simplize (public commodity pages, SSR,
 * real published values + published "related stocks") → Vietnambiz (SJC gold
 * board) → Yahoo Finance futures (chart + fallback quote) → MSN Finance →
 * Binance PAXG (gold spot cross-check). Every record carries source + real
 * timestamps when the source publishes them; otherwise freshness stays
 * DELAYED (never fake LIVE). No endpoint here is invented: the Simplize
 * public page URLs below were verified live (page 200, real values).
 */

export const SIMPLIZE = "simplize";
export const VIETNAMBIZ = "vietnambiz";
export const MSN_FINANCE = "msn-finance";
export const BINANCE_PAXG = "binance-paxg";
export const YAHOO_FUTURES = "yahoo-futures";

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

/* ------------------------------ catalog ----------------------------------- */

export type CommodityGroup = "metals" | "energy" | "industrial" | "agriculture" | "vietnam" | "livestock" | "seafood";

export type CommodityCategory =
  | "precious-metals"
  | "industrial-metals"
  | "energy"
  | "agriculture"
  | "soft-commodities"
  | "fertilizers"
  | "livestock"
  | "seafood"
  | "other";

/** official universe: market = Vietnam (domestic price) vs International */
export type CommodityMarket = "VN" | "INTL";

/** per-stock impact relation (evidence-based, curated industry mapping) */
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
  /** per-stock relation (falls back to CONDITIONAL/MEDIUM/MACRO_SENSITIVITY) */
  relations?: Record<string, CommodityRelation>;
}

export interface CommodityDef {
  key: string;
  name: string;
  nameVi: string;
  group: CommodityGroup;
  category: CommodityCategory;
  subcategory?: string;
  /** sub-group alias per unified model */
  subgroup?: string;
  /** Vietnam domestic price vs International market */
  market: CommodityMarket;
  symbol: string;
  unit: string;
  currency: string;
  /** public Simplize commodity page path (verified live) */
  simplizePath?: string;
  /** Yahoo futures ticker used for chart + fallback quote (real, documented) */
  yahooSymbol?: string;
  /** Binance spot proxy for 24/7 gold */
  binanceSymbol?: string;
  /** provider quotes in US cents (KC/SB/ZC/ZS) → keep as displayed (USd/…) */
  centsQuoted?: boolean;
  /** Vietnambiz scrape strategy */
  vietnambiz?: "sjc-gold";
  /** news-filter keywords for the NEWS & CATALYST engine (title/summary match) */
  newsKeywords?: string[];
  /** verified economic exposure (mechanism from public industry descriptions) */
  vnImpact?: CommodityImpactMap;
  /** display aid: source page URL for provenance */
  sourceUrl?: string;
}

export const COMMODITY_CATALOG: CommodityDef[] = [
  {
    key: "gold", name: "Gold", nameVi: "Vàng thế giới", group: "metals", category: "precious-metals", subcategory: "Bullion",
    symbol: "XAUUSD", unit: "USD/oz", currency: "USD", market: "INTL", simplizePath: "/gia-vang/the-gioi",
    yahooSymbol: "GC=F", binanceSymbol: "PAXGUSDT",
    newsKeywords: ["vàng", "gold", "kim loại quý"],
    vnImpact: {
      sector: "Tài sản & Bán lẻ vàng", stocks: ["PNJ", "BID", "ACB", "VCB", "CTG"],
      mechanism: "Giá vàng thế giới dẫn giá vàng nội địa → doanh thu bán lẻ vàng (PNJ) và kênh trú ẩn tài sản",
      relations: {
        PNJ: { relationshipType: "REVENUE_DRIVER", direction: "POSITIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Giá vàng tăng → doanh thu bán lẻ vàng tăng (biên mua–bán)" },
        BID: { relationshipType: "MACRO_SENSITIVITY", direction: "CONDITIONAL", impactStrength: "LOW", confidence: "LOW", channel: "Giá vàng là kênh trú ẩn cạnh tranh tiền gửi" },
        ACB: { relationshipType: "MACRO_SENSITIVITY", direction: "CONDITIONAL", impactStrength: "LOW", confidence: "LOW", channel: "Giá vàng là kênh trú ẩn cạnh tranh tiền gửi" },
        VCB: { relationshipType: "MACRO_SENSITIVITY", direction: "CONDITIONAL", impactStrength: "LOW", confidence: "LOW", channel: "Giá vàng là kênh trú ẩn cạnh tranh tiền gửi" },
        CTG: { relationshipType: "MACRO_SENSITIVITY", direction: "CONDITIONAL", impactStrength: "LOW", confidence: "LOW", channel: "Giá vàng là kênh trú ẩn cạnh tranh tiền gửi" },
      },
    },
  },
  {
    key: "silver", name: "Silver", nameVi: "Bạc", group: "metals", category: "precious-metals", subcategory: "Bullion",
    symbol: "XAGUSD", unit: "USD/oz", currency: "USD", market: "INTL", simplizePath: "/gia-bac-the-gioi", yahooSymbol: "SI=F",
    newsKeywords: ["bạc", "silver"],
    vnImpact: {
      sector: "Trang sức & Công nghiệp", stocks: ["PNJ"],
      mechanism: "Bạc là nguyên liệu trang sức và công nghiệp điện tử; giá tăng → chi phí nguyên liệu tăng",
      relations: {
        PNJ: { relationshipType: "INPUT_COST", direction: "MIXED", impactStrength: "LOW", confidence: "LOW", channel: "Mặt hàng bạc trang sức" },
      },
    },
  },
  {
    key: "platinum", name: "Platinum", nameVi: "Platinum", group: "metals", category: "precious-metals", subcategory: "Bullion",
    symbol: "XPTUSD", unit: "USD/oz", currency: "USD", market: "INTL", yahooSymbol: "PL=F",
  },
  {
    key: "palladium", name: "Palladium", nameVi: "Palladium", group: "metals", category: "precious-metals", subcategory: "Bullion",
    symbol: "XPDUSD", unit: "USD/oz", currency: "USD", market: "INTL", yahooSymbol: "PA=F",
  },
  {
    key: "wti", name: "WTI Crude Oil", nameVi: "Dầu thô WTI", group: "energy", category: "energy", subcategory: "Crude",
    symbol: "CL", unit: "USD/bbl", currency: "USD", market: "INTL", simplizePath: "/hang-hoa/wti", yahooSymbol: "CL=F",
    vnImpact: { sector: "Dầu khí", stocks: ["GAS", "PLX", "BSR", "PVD", "PVS", "PVT"], mechanism: "Giá dầu tác động trực tiếp doanh thu khai thác, vận tải và phân phối" },
  },
  {
    key: "brent", name: "Brent Crude Oil", nameVi: "Dầu Brent", group: "energy", category: "energy", subcategory: "Crude",
    symbol: "BZ", unit: "USD/bbl", currency: "USD", market: "INTL", yahooSymbol: "BZ=F",
    vnImpact: { sector: "Dầu khí", stocks: ["GAS", "PLX", "BSR", "OIL"], mechanism: "Chuẩn giá dầu tham chiếu cho hợp đồng khu vực" },
  },
  {
    key: "natgas", name: "Natural Gas", nameVi: "Khí thiên nhiên", group: "energy", category: "energy", subcategory: "Gas",
    symbol: "NG", unit: "USD/MMBtu", currency: "USD", market: "INTL", simplizePath: "/hang-hoa/khi-thien-nhien", yahooSymbol: "NG=F",
    vnImpact: { sector: "Điện & Phân bón", stocks: ["GAS", "POW", "DCM", "DPM", "CNG", "PGD", "NT2"], mechanism: "Chi phí đầu vào cho điện lực, phân bón và kinh doanh khí" },
  },
  {
    key: "coal", name: "Coking Coal", nameVi: "Than cốc", group: "energy", category: "energy", subcategory: "Coal",
    symbol: "COAL", unit: "USD/T", currency: "USD", market: "INTL", simplizePath: "/hang-hoa/than-coc",
    newsKeywords: ["than", "than cốc", "coking coal"],
    vnImpact: {
      sector: "Thép & Nhiệt điện", stocks: ["HPG", "HSG", "QTP", "NT2"],
      mechanism: "Than cốc là nguyên liệu luyện thép và nhiên liệu nhiệt điện; giá tăng → chi phí đầu vào tăng",
      relations: {
        HPG: { relationshipType: "INPUT_COST", direction: "NEGATIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Than cốc trong sản xuất thép" },
        HSG: { relationshipType: "INPUT_COST", direction: "NEGATIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Than cốc trong sản xuất thép" },
        QTP: { relationshipType: "INPUT_COST", direction: "MIXED", impactStrength: "MEDIUM", confidence: "LOW", channel: "Nhiệt điện than — chi phí tăng, giá điện điều chỉnh" },
        NT2: { relationshipType: "INPUT_COST", direction: "MIXED", impactStrength: "MEDIUM", confidence: "LOW", channel: "Nhiệt điện than — chi phí tăng, giá điện điều chỉnh" },
      },
    },
  },
  {
    key: "copper", name: "Copper", nameVi: "Đồng", group: "industrial", category: "industrial-metals", subcategory: "Base Metals",
    symbol: "HG", unit: "USD/lb", currency: "USD", market: "INTL", simplizePath: "/hang-hoa/gia-dong", yahooSymbol: "HG=F",
    vnImpact: { sector: "Kim loại", stocks: ["HSG", "NKG", "HPG"], mechanism: "Chỉ báo chu kỳ kim loại công nghiệp, ảnh hưởng giá nguyên liệu ngành thép" },
  },
  {
    key: "aluminum", name: "Aluminum", nameVi: "Nhôm", group: "industrial", category: "industrial-metals", subcategory: "Base Metals",
    symbol: "AL", unit: "USD/T", currency: "USD", market: "INTL",
  },
  {
    key: "zinc", name: "Zinc", nameVi: "Kẽm", group: "industrial", category: "industrial-metals", subcategory: "Base Metals",
    symbol: "ZN", unit: "USD/T", currency: "USD", market: "INTL",
  },
  {
    key: "nickel", name: "Nickel", nameVi: "Nickel", group: "industrial", category: "industrial-metals", subcategory: "Base Metals",
    symbol: "NI", unit: "USD/T", currency: "USD", market: "INTL", simplizePath: "/hang-hoa/gia-nickel",
    newsKeywords: ["niken", "nickel"],
    vnImpact: {
      sector: "Kim loại — Thép không gỉ", stocks: ["HPG", "VCA"],
      mechanism: "Nickel là nguyên liệu thép không gỉ; giá tăng → chi phí đầu vào của nhà sản xuất kim loại",
      relations: {
        HPG: { relationshipType: "MACRO_SENSITIVITY", direction: "CONDITIONAL", impactStrength: "LOW", confidence: "LOW", channel: "Giá kim loại công nghiệp phản ánh chu kỳ ngành" },
        VCA: { relationshipType: "INPUT_COST", direction: "MIXED", impactStrength: "LOW", confidence: "LOW", channel: "Nguyên liệu thép không gỉ" },
      },
    },
  },
  {
    key: "iron-ore", name: "Iron Ore", nameVi: "Quặng sắt", group: "industrial", category: "industrial-metals", subcategory: "Bulk",
    symbol: "IO", unit: "USD/T", currency: "USD", market: "INTL", simplizePath: "/hang-hoa/gia-quang-sat",
    vnImpact: { sector: "Thép", stocks: ["HPG", "HSG", "NKG"], mechanism: "Chi phí nguyên liệu đầu vào quyết định biên lợi nhuận thép" },
  },
  {
    key: "steel", name: "Steel HRC", nameVi: "Thép HRC", group: "industrial", category: "industrial-metals", subcategory: "Steel",
    symbol: "HRC", unit: "USD/T", currency: "USD", market: "INTL", simplizePath: "/hang-hoa/gia-thep-hrc",
    vnImpact: { sector: "Thép", stocks: ["HPG", "HSG", "NKG", "SMC", "TLH", "VGS", "TVN"], mechanism: "Giá thép quyết định biên lợi nhuận doanh nghiệp thép" },
  },
  {
    key: "wheat", name: "Wheat", nameVi: "Lúa mì", group: "agriculture", category: "agriculture", subcategory: "Grains",
    symbol: "ZW", unit: "USd/bu", currency: "USD", market: "INTL", yahooSymbol: "ZW=F", centsQuoted: true,
  },
  {
    key: "corn", name: "Corn", nameVi: "Ngô", group: "agriculture", category: "agriculture", subcategory: "Grains",
    symbol: "ZC", unit: "USd/bu", currency: "USD", market: "INTL", simplizePath: "/hang-hoa/gia-ngo", yahooSymbol: "ZC=F", centsQuoted: true,
    vnImpact: { sector: "Chăn nuôi", stocks: ["DBC", "BAF", "HAG"], mechanism: "Chi phí thức ăn chăn nuôi" },
  },
  {
    key: "soybean", name: "Soybean", nameVi: "Đậu tương", group: "agriculture", category: "agriculture", subcategory: "Grains",
    symbol: "ZS", unit: "USd/bu", currency: "USD", market: "INTL", simplizePath: "/hang-hoa/gia-dau-nanh", yahooSymbol: "ZS=F", centsQuoted: true,
    vnImpact: { sector: "Chăn nuôi", stocks: ["DBC", "BAF"], mechanism: "Chi phí thức ăn chăn nuôi" },
  },
  {
    key: "rice", name: "Rough Rice", nameVi: "Gạo", group: "agriculture", category: "agriculture", subcategory: "Grains",
    symbol: "ZR", unit: "USD/cwt", currency: "USD", market: "INTL", simplizePath: "/hang-hoa/gia-gao", yahooSymbol: "ZR=F",
    vnImpact: { sector: "Nông nghiệp & Lương thực", stocks: ["PAN", "AFX", "LTG", "VSF"], mechanism: "Giá gạo tác động doanh thu xuất khẩu và chế biến lương thực" },
  },
  {
    key: "coffee", name: "Coffee (Arabica)", nameVi: "Cà phê", group: "agriculture", category: "soft-commodities", subcategory: "Beverages",
    symbol: "KC", unit: "US cent/lb", currency: "USD", market: "INTL", simplizePath: "/hang-hoa/gia-ca-phe-arabica", yahooSymbol: "KC=F", centsQuoted: true,
    vnImpact: { sector: "Nông nghiệp", stocks: ["VNM", "PAN"], mechanism: "Việt Nam là nước xuất khẩu robusta lớn thứ hai thế giới" },
  },
  {
    key: "sugar", name: "Sugar", nameVi: "Đường", group: "agriculture", category: "soft-commodities", subcategory: "Beverages",
    symbol: "SB", unit: "USd/lb", currency: "USD", market: "INTL", simplizePath: "/hang-hoa/gia-duong", yahooSymbol: "SB=F", centsQuoted: true,
    vnImpact: { sector: "Nông nghiệp", stocks: ["QNS", "LSS", "SBT", "KTS", "SLS", "CBS"], mechanism: "Giá đường thế giới chi phối giá mía đường nội địa" },
  },
  {
    key: "cotton", name: "Cotton", nameVi: "Bông", group: "agriculture", category: "soft-commodities", subcategory: "Textiles",
    symbol: "CT", unit: "US cent/lb", currency: "USD", market: "INTL", simplizePath: "/hang-hoa/gia-bong", yahooSymbol: "CT=F", centsQuoted: true,
    newsKeywords: ["bông", "cotton", "dệt may"],
    vnImpact: {
      sector: "Dệt may", stocks: ["TNG", "MSH", "GIL"],
      mechanism: "Việt Nam nhập khẩu bông; giá bông tăng → chi phí nguyên liệu dệt may tăng",
      relations: {
        TNG: { relationshipType: "INPUT_COST", direction: "NEGATIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Chi phí nguyên liệu sợi" },
        MSH: { relationshipType: "INPUT_COST", direction: "NEGATIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Chi phí nguyên liệu sợi" },
        GIL: { relationshipType: "INPUT_COST", direction: "NEGATIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Chi phí nguyên liệu sợi" },
      },
    },
  },
  {
    key: "urea", name: "Urea", nameVi: "Phân URE", group: "agriculture", category: "fertilizers", subcategory: "Nitrogen",
    symbol: "URE", unit: "USD/T", currency: "USD", market: "INTL", simplizePath: "/hang-hoa/gia-phan-ure",
    vnImpact: { sector: "Phân bón", stocks: ["DCM", "DPM", "SFG", "LAS"], mechanism: "Giá ure nhập khẩu quyết định giá thành phân bón nội địa" },
  },
  {
    key: "sjc-gold", name: "SJC Gold (VN)", nameVi: "Vàng SJC", group: "vietnam", category: "precious-metals", subcategory: "Domestic (VN)", subgroup: "Domestic (VN)",
    symbol: "SJC", unit: "VNĐ/Lượng", currency: "VND", market: "VN", simplizePath: "/gia-vang/pnj/vang-mieng-sjc-9999-pnj", vietnambiz: "sjc-gold",
    newsKeywords: ["vàng", "sjc", "gold"],
    vnImpact: {
      sector: "Tài sản nội & Bán lẻ vàng", stocks: ["PNJ"],
      mechanism: "Giá vàng SJC dẫn tâm lý đầu tư tài sản trong nước và doanh thu bán lẻ vàng",
      relations: {
        PNJ: { relationshipType: "REVENUE_DRIVER", direction: "POSITIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Giá vàng nội địa tăng → doanh thu bán lẻ vàng tăng" },
      },
    },
  },
  /* ------------------------- official universe — VN market ------------------------- */
  {
    key: "steel-d10", name: "Steel Rebar D10 (VN)", nameVi: "Thép D10", group: "industrial", category: "industrial-metals", subcategory: "Steel", subgroup: "Steel",
    market: "VN", symbol: "D10", unit: "Nghìn đồng/kg", currency: "VND", simplizePath: "/hang-hoa/gia-thep-d10",
    newsKeywords: ["thép", "giá thép"],
    vnImpact: {
      sector: "Thép & Xây dựng", stocks: ["HPG", "HSG", "NKG", "TLH", "VGS", "TVN"],
      mechanism: "Giá thép D10 tăng → doanh thu thép bán ra tăng (nếu bán được giá) nhưng chi phí đầu vào xây dựng tăng",
      relations: {
        HPG: { relationshipType: "SELLING_PRICE", direction: "MIXED", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Giá bán thép tăng → biên lợi nhuận cải thiện khi chi phí nguyên liệu tăng chậm hơn" },
        HSG: { relationshipType: "SELLING_PRICE", direction: "MIXED", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Giá bán thép tăng → biên lợi nhuận cải thiện khi chi phí nguyên liệu tăng chậm hơn" },
        NKG: { relationshipType: "SELLING_PRICE", direction: "MIXED", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Giá bán thép tăng → biên lợi nhuận cải thiện khi chi phí nguyên liệu tăng chậm hơn" },
        TLH: { relationshipType: "SELLING_PRICE", direction: "MIXED", impactStrength: "MEDIUM", confidence: "LOW", channel: "Nhà máy thép bán theo giá thị trường" },
        VGS: { relationshipType: "SELLING_PRICE", direction: "MIXED", impactStrength: "MEDIUM", confidence: "LOW", channel: "Giá thép thượng nguồn ảnh hưởng giá ống thép" },
        TVN: { relationshipType: "SELLING_PRICE", direction: "MIXED", impactStrength: "MEDIUM", confidence: "LOW", channel: "Doanh thu thép của nhà máy thép" },
      },
    },
  },
  {
    key: "gasoline-95", name: "Gasoline RON95 (VN)", nameVi: "Xăng RON95", group: "energy", category: "energy", subcategory: "Gasoline", subgroup: "Gasoline",
    market: "VN", symbol: "RON95", unit: "Nghìn đồng/lít", currency: "VND", simplizePath: "/hang-hoa/gia-xang-ron95",
    newsKeywords: ["xăng", "giá xăng dầu", "dầu"],
    vnImpact: {
      sector: "Dầu khí & Vận tải", stocks: ["PLX", "OIL", "VIP", "VTO", "GMD"],
      mechanism: "Giá xăng RON95 điều hành theo giá dầu thế giới; tăng → doanh thu bán lẻ xăng dầu tăng, chi phí vận tải/logistics tăng",
      relations: {
        PLX: { relationshipType: "SELLING_PRICE", direction: "POSITIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Giá bán được điều chỉnh theo chi phí → doanh thu bán lẻ tăng" },
        OIL: { relationshipType: "SELLING_PRICE", direction: "POSITIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Giá bán được điều chỉnh theo chi phí → doanh thu bán lẻ tăng" },
        VIP: { relationshipType: "INPUT_COST", direction: "NEGATIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Chi phí vận tải xăng dầu tăng" },
        VTO: { relationshipType: "INPUT_COST", direction: "NEGATIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Chi phí vận tải xăng dầu tăng" },
        GMD: { relationshipType: "INPUT_COST", direction: "NEGATIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Chi phí nhiên liệu logistics tăng" },
      },
    },
  },
  {
    key: "gasoline-92", name: "Gasoline RON92 (VN)", nameVi: "Xăng RON92", group: "energy", category: "energy", subcategory: "Gasoline", subgroup: "Gasoline",
    market: "VN", symbol: "RON92", unit: "Nghìn đồng/lít", currency: "VND", simplizePath: "/hang-hoa/gia-xang-ron92",
    newsKeywords: ["xăng", "giá xăng dầu", "dầu"],
    vnImpact: {
      sector: "Dầu khí & Vận tải", stocks: ["PLX", "OIL", "VIP", "VTO", "GMD"],
      mechanism: "Giá xăng RON92 điều hành theo giá dầu thế giới; tăng → doanh thu bán lẻ tăng, chi phí vận tải tăng",
      relations: {
        PLX: { relationshipType: "SELLING_PRICE", direction: "POSITIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Giá bán được điều chỉnh theo chi phí → doanh thu bán lẻ tăng" },
        OIL: { relationshipType: "SELLING_PRICE", direction: "POSITIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Giá bán được điều chỉnh theo chi phí → doanh thu bán lẻ tăng" },
        VIP: { relationshipType: "INPUT_COST", direction: "NEGATIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Chi phí vận tải xăng dầu tăng" },
        VTO: { relationshipType: "INPUT_COST", direction: "NEGATIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Chi phí vận tải xăng dầu tăng" },
        GMD: { relationshipType: "INPUT_COST", direction: "NEGATIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Chi phí nhiên liệu logistics tăng" },
      },
    },
  },
  {
    key: "diesel", name: "Diesel DO (VN)", nameVi: "Dầu DO", group: "energy", category: "energy", subcategory: "Diesel", subgroup: "Diesel",
    market: "VN", symbol: "DO", unit: "Nghìn đồng/lít", currency: "VND", simplizePath: "/hang-hoa/gia-dau-diesel",
    newsKeywords: ["dầu", "diesel", "xăng dầu"],
    vnImpact: {
      sector: "Vận tải & Logistics", stocks: ["GMD", "VTO", "VIP", "PLX", "OIL"],
      mechanism: "Giá diesel là chi phí đầu vào trực tiếp của vận tải/logistics; tăng → chi phí vận tải tăng",
      relations: {
        GMD: { relationshipType: "INPUT_COST", direction: "NEGATIVE", impactStrength: "HIGH", confidence: "MEDIUM", channel: "Nhiên liệu là chi phí vận hành chính của cảng/logistics" },
        VTO: { relationshipType: "INPUT_COST", direction: "NEGATIVE", impactStrength: "HIGH", confidence: "MEDIUM", channel: "Vận tải xăng dầu tiêu hao diesel lớn" },
        VIP: { relationshipType: "INPUT_COST", direction: "NEGATIVE", impactStrength: "HIGH", confidence: "MEDIUM", channel: "Vận tải xăng dầu tiêu hao diesel lớn" },
        PLX: { relationshipType: "SELLING_PRICE", direction: "POSITIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Giá bán điều hành theo chi phí → doanh thu bán lẻ tăng" },
        OIL: { relationshipType: "SELLING_PRICE", direction: "POSITIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Giá bán điều hành theo chi phí → doanh thu bán lẻ tăng" },
      },
    },
  },
  {
    key: "pig-vn", name: "Live Hog North VN", nameVi: "Heo hơi miền Bắc", group: "livestock", category: "livestock", subcategory: "Hogs — VN", subgroup: "Hogs — VN",
    market: "VN", symbol: "PIGVN", unit: "VNĐ/kg", currency: "VND", simplizePath: "/hang-hoa/gia-heo-hoi-mien-bac",
    newsKeywords: ["heo hơi", "thịt heo", "chăn nuôi", "lợn"],
    vnImpact: {
      sector: "Chăn nuôi & Thực phẩm", stocks: ["DBC", "BAF", "HAG", "MML"],
      mechanism: "Giá heo hơi tăng → doanh thu trang trại tăng, chi phí nguyên liệu chế biến thực phẩm tăng",
      relations: {
        DBC: { relationshipType: "REVENUE_DRIVER", direction: "POSITIVE", impactStrength: "HIGH", confidence: "MEDIUM", channel: "Giá bán heo hơi tăng trực tiếp vào doanh thu trang trại" },
        BAF: { relationshipType: "REVENUE_DRIVER", direction: "POSITIVE", impactStrength: "HIGH", confidence: "MEDIUM", channel: "Giá bán heo hơi tăng trực tiếp vào doanh thu trang trại" },
        HAG: { relationshipType: "REVENUE_DRIVER", direction: "POSITIVE", impactStrength: "MEDIUM", confidence: "LOW", channel: "Mảng chăn nuôi phụ thuộc giá heo hơi" },
        MML: { relationshipType: "INPUT_COST", direction: "NEGATIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Thịt heo là nguyên liệu chế biến thực phẩm" },
      },
    },
  },
  {
    key: "shrimp-vn", name: "Whiteleg Shrimp (VN)", nameVi: "Tôm thẻ (tại ao)", group: "seafood", category: "seafood", subcategory: "Shrimp", subgroup: "Shrimp",
    market: "VN", symbol: "TOMTHE", unit: "Nghìn đồng/kg", currency: "VND", simplizePath: "/hang-hoa/gia-tom-the",
    newsKeywords: ["tôm", "tôm thẻ", "thủy sản"],
    vnImpact: {
      sector: "Thủy sản — Tôm", stocks: ["FMC", "MPC", "CMX", "ABT"],
      mechanism: "Giá tôm nguyên liệu tăng → chi phí thu mua chế biến tăng; giá bán xuất khẩu có thể tăng khi nhu cầu mạnh",
      relations: {
        FMC: { relationshipType: "INPUT_COST", direction: "MIXED", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Thu mua tôm nguyên liệu → chi phí tăng, giá bán xuất khẩu điều chỉnh" },
        MPC: { relationshipType: "INPUT_COST", direction: "MIXED", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Thu mua tôm nguyên liệu → chi phí tăng, giá bán xuất khẩu điều chỉnh" },
        CMX: { relationshipType: "INPUT_COST", direction: "MIXED", impactStrength: "MEDIUM", confidence: "LOW", channel: "Thu mua tôm nguyên liệu → chi phí tăng" },
        ABT: { relationshipType: "INPUT_COST", direction: "MIXED", impactStrength: "MEDIUM", confidence: "LOW", channel: "Thu mua tôm nguyên liệu → chi phí tăng" },
      },
    },
  },
  {
    key: "pangasius", name: "Pangasius (VN)", nameVi: "Cá tra (tại ao)", group: "seafood", category: "seafood", subcategory: "Pangasius", subgroup: "Pangasius",
    market: "VN", symbol: "CATRA", unit: "Nghìn đồng/kg", currency: "VND", simplizePath: "/hang-hoa/gia-ca-tra-vietnam",
    newsKeywords: ["cá tra", "pangasius", "cá ba sa"],
    vnImpact: {
      sector: "Thủy sản — Cá tra", stocks: ["VHC", "ANV", "IDI", "ASM"],
      mechanism: "Giá cá tra nguyên liệu tăng → chi phí thu mua tăng, giá bán xuất khẩu thường điều chỉnh theo nguồn cung",
      relations: {
        VHC: { relationshipType: "INPUT_COST", direction: "MIXED", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Chuỗi nuôi–chế biến tự chủ; giá nguyên liệu tăng đẩy giá bán" },
        ANV: { relationshipType: "INPUT_COST", direction: "MIXED", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Thu mua cá tra nguyên liệu" },
        IDI: { relationshipType: "INPUT_COST", direction: "MIXED", impactStrength: "MEDIUM", confidence: "LOW", channel: "Thu mua cá tra nguyên liệu" },
        ASM: { relationshipType: "INPUT_COST", direction: "MIXED", impactStrength: "MEDIUM", confidence: "LOW", channel: "Mảng thủy sản thu mua nguyên liệu" },
      },
    },
  },
  /* ------------------------- official universe — INTL market ------------------------- */
  {
    key: "coffee-robusta", name: "Robusta Coffee", nameVi: "Cà phê Robusta", group: "agriculture", category: "soft-commodities", subcategory: "Beverages", subgroup: "Beverages",
    market: "INTL", symbol: "RC", unit: "USD/T", currency: "USD", simplizePath: "/hang-hoa/gia-ca-phe-robusta", yahooSymbol: "RC=F",
    newsKeywords: ["cà phê", "robusta", "coffee"],
    vnImpact: {
      sector: "Nông sản — Cà phê", stocks: ["PAN", "VNM"],
      mechanism: "Việt Nam xuất khẩu robusta lớn thứ hai thế giới; giá robusta chi phối thu nhập hộ trồng và doanh thu chế biến",
      relations: {
        PAN: { relationshipType: "REVENUE_DRIVER", direction: "POSITIVE", impactStrength: "MEDIUM", confidence: "LOW", channel: "Giá cà phê tăng → doanh thu kinh doanh nông sản" },
        VNM: { relationshipType: "MACRO_SENSITIVITY", direction: "CONDITIONAL", impactStrength: "LOW", confidence: "LOW", channel: "Tiêu dùng nông sản gián tiếp" },
      },
    },
  },
  {
    key: "milk-wmp", name: "Whole Milk Powder", nameVi: "Sữa bột nguyên kem", group: "livestock", category: "livestock", subcategory: "Whole Milk Powder", subgroup: "Whole Milk Powder",
    market: "INTL", symbol: "MILKWMP", unit: "USD/MT", currency: "USD", simplizePath: "/hang-hoa/gia-sua-bot-nguyen-kem-nguyen-lieu",
    newsKeywords: ["sữa bột", "sữa", "dairy", "nguyên kem"],
    vnImpact: {
      sector: "Sữa & Thực phẩm", stocks: ["VNM", "MCM"],
      mechanism: "Sữa bột nguyên liệu là chi phí đầu vào chính của ngành sữa; giá tăng → chi phí sản xuất tăng",
      relations: {
        VNM: { relationshipType: "INPUT_COST", direction: "MIXED", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Nguyên liệu sữa tăng → chi phí tăng; có thể chuyển một phần vào giá bán" },
        MCM: { relationshipType: "INPUT_COST", direction: "MIXED", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Nguyên liệu sữa tăng → chi phí tăng; có thể chuyển một phần vào giá bán" },
      },
    },
  },
  {
    key: "milk-smp", name: "Skim Milk Powder", nameVi: "Sữa bột tách béo", group: "livestock", category: "livestock", subcategory: "Skim Milk Powder", subgroup: "Skim Milk Powder",
    market: "INTL", symbol: "MILKSMP", unit: "USD/MT", currency: "USD", simplizePath: "/hang-hoa/gia-sua-bot-tach-beo-nguyen-lieu",
    newsKeywords: ["sữa bột", "sữa", "dairy", "tách béo"],
    vnImpact: {
      sector: "Sữa & Thực phẩm", stocks: ["VNM", "MCM"],
      mechanism: "Sữa bột tách béo nguyên liệu là chi phí đầu vào của ngành sữa và chế biến thực phẩm",
      relations: {
        VNM: { relationshipType: "INPUT_COST", direction: "MIXED", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Nguyên liệu sữa tăng → chi phí tăng; có thể chuyển một phần vào giá bán" },
        MCM: { relationshipType: "INPUT_COST", direction: "MIXED", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Nguyên liệu sữa tăng → chi phí tăng; có thể chuyển một phần vào giá bán" },
      },
    },
  },
  {
    key: "rubber-tsr20", name: "Rubber TSR20 (Tokyo)", nameVi: "Cao su TSR20", group: "agriculture", category: "soft-commodities", subcategory: "Rubber", subgroup: "Rubber",
    market: "INTL", symbol: "RUBTSR20", unit: "JPY/kg", currency: "JPY", simplizePath: "/hang-hoa/gia-cao-su-tsr20",
    newsKeywords: ["cao su", "mủ cao su", "rubber"],
    vnImpact: {
      sector: "Cao su", stocks: ["GVR", "PHR", "DPR", "TRC"],
      mechanism: "Giá mủ cao su tăng → doanh thu đồn điền và chế biến mủ tăng",
      relations: {
        GVR: { relationshipType: "REVENUE_DRIVER", direction: "POSITIVE", impactStrength: "HIGH", confidence: "MEDIUM", channel: "Doanh thu mủ cao su chi phối kết quả" },
        PHR: { relationshipType: "REVENUE_DRIVER", direction: "POSITIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Doanh thu mủ cao su chi phối kết quả" },
        DPR: { relationshipType: "REVENUE_DRIVER", direction: "POSITIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Doanh thu mủ cao su chi phối kết quả" },
        TRC: { relationshipType: "REVENUE_DRIVER", direction: "POSITIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Doanh thu mủ cao su chi phối kết quả" },
      },
    },
  },
  {
    key: "rubber-rss3", name: "Rubber RSS3 (Tokyo)", nameVi: "Cao su RSS3", group: "agriculture", category: "soft-commodities", subcategory: "Rubber", subgroup: "Rubber",
    market: "INTL", symbol: "RUBRSS3", unit: "JPY/kg", currency: "JPY", simplizePath: "/hang-hoa/gia-cao-su-rss3",
    newsKeywords: ["cao su", "mủ cao su", "rubber"],
    vnImpact: {
      sector: "Cao su", stocks: ["GVR", "PHR", "DPR", "TRC"],
      mechanism: "Giá mủ cao su tăng → doanh thu đồn điền và chế biến mủ tăng",
      relations: {
        GVR: { relationshipType: "REVENUE_DRIVER", direction: "POSITIVE", impactStrength: "HIGH", confidence: "MEDIUM", channel: "Doanh thu mủ cao su chi phối kết quả" },
        PHR: { relationshipType: "REVENUE_DRIVER", direction: "POSITIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Doanh thu mủ cao su chi phối kết quả" },
        DPR: { relationshipType: "REVENUE_DRIVER", direction: "POSITIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Doanh thu mủ cao su chi phối kết quả" },
        TRC: { relationshipType: "REVENUE_DRIVER", direction: "POSITIVE", impactStrength: "MEDIUM", confidence: "MEDIUM", channel: "Doanh thu mủ cao su chi phối kết quả" },
      },
    },
  },
  {
    key: "pig-cn", name: "Live Hog China", nameVi: "Heo hơi Trung Quốc", group: "livestock", category: "livestock", subcategory: "Hogs — CN", subgroup: "Hogs — CN",
    market: "INTL", symbol: "PIGCN", unit: "CNY/kg", currency: "CNY", simplizePath: "/hang-hoa/gia-heo-hoi-trung-quoc",
    newsKeywords: ["heo hơi", "thịt heo", "trung quốc", "chăn nuôi"],
    vnImpact: {
      sector: "Chăn nuôi (giá tham chiếu khu vực)", stocks: ["DBC", "BAF"],
      mechanism: "Giá heo TQ phản ánh chu kỳ thị trường heo khu vực; ảnh hưởng gián tiếp qua giá thức ăn và cạnh tranh nhập khẩu",
      relations: {
        DBC: { relationshipType: "MACRO_SENSITIVITY", direction: "CONDITIONAL", impactStrength: "LOW", confidence: "LOW", channel: "Giá thịt heo khu vực → tâm lý và chu kỳ ngành" },
        BAF: { relationshipType: "MACRO_SENSITIVITY", direction: "CONDITIONAL", impactStrength: "LOW", confidence: "LOW", channel: "Giá thịt heo khu vực → tâm lý và chu kỳ ngành" },
      },
    },
  },
];

/** Legacy MSN key mapping kept for the MSN fallback provider. */
export const MSN_KEY_BY_KEY: Record<string, string> = {
  gold: "GOLD", silver: "SILVER", wti: "WTI", brent: "BRENT", natgas: "NATGAS",
  copper: "COPPER", steel: "STEEL", coffee: "COFFEE", sugar: "SUGAR", corn: "CORN",
  wheat: "WHEAT", soybean: "SOYBEAN",
};

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

/** map a published unit string to a currency code (public page is the source of truth) */
export function currencyForUnit(unit: string | null | undefined): string {
  const u = (unit ?? "").toUpperCase();
  if (/VNĐ|VND|ĐỒNG/.test(u)) return "VND";
  if (/CNY/.test(u)) return "CNY";
  if (/JPY/.test(u)) return "JPY";
  if (/EUR/.test(u)) return "EUR";
  if (/GBP/.test(u)) return "GBP";
  return "USD";
}

/* ------------------------------ Simplize page ------------------------------ */

export interface SimplizeParsed {
  price: number;
  change: number | null;
  changePercent: number | null;
  previousClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  unit: string | null;
  perf: Partial<Record<"1W" | "1M" | "3M" | "YTD" | "1Y" | "5Y", number>>;
  relatedStocks: string[];
  timestamp: number | null;
}

const PERF_KEYS: { label: string; key: "1W" | "1M" | "3M" | "YTD" | "1Y" | "5Y" }[] = [
  { label: "7D", key: "1W" },
  { label: "1M", key: "1M" },
  { label: "3M", key: "3M" },
  { label: "YTD", key: "YTD" },
  { label: "1Y", key: "1Y" },
  { label: "5Y", key: "5Y" },
];

const stripTags = (s: string) =>
  s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#\d+;/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ");

function pct(s: string): number | null {
  const m = s.replace(/[%\s]/g, "").match(/^([+-]?[\d.,]+)$/);
  if (!m) return null;
  const v = parseDecimal(m[1]);
  return Number.isFinite(v) ? v : null;
}

/**
 * Parse the stripped text of a Simplize commodity detail page (verified live
 * structure: "Giá hiện tại", "Giá đóng cửa hôm trước", "Giá mở cửa",
 * "Biên độ ngày", "Biên độ 52 tuần", "Đơn vị tính", "% 7D/1M/3M/YTD/1Y/5Y",
 * "Cổ phiếu liên quan", and optionally "Cập nhật lúc … ngày …").
 */
export function parseSimplizePage(text: string): SimplizeParsed | null {
  const t = stripTags(text);
  const priceM = t.match(/Giá\s*hiện\s*tại\s*:?\s*([\d.,]+)/);
  if (!priceM) return null;
  const price = parseDecimal(priceM[1]);
  if (!Number.isFinite(price) || price <= 0) return null;

  // change block: "<price> <±change> <±pct>". Real pages render 3 variants:
  // 1) joined  "+1,200,000 0.81%"   2) split sign  "+ 0.18 0.20%"
  // 3) flat     "- 0.00%"            → try them in order, never guess.
  const after = t.slice(priceM.index! + priceM[0].length, priceM.index! + priceM[0].length + 120);
  let change: number | null = null;
  let changePercent: number | null = null;
  const joined = after.match(/^\s*([+-]?[\d.,]+)\s*([+-]?[\d.,]+%)/);
  // flat must be checked BEFORE splitSign: "- 0.00%" (sign node + pct only)
  // must not be re-interpreted as change=-0.00 with pct from the same token.
  const flat = !joined ? after.match(/^\s*-\s*([+-]?[\d.,]+%)/) : null;
  const splitSign = !joined && !flat ? after.match(/^\s*([+-])\s*([\d.,]+)\s*([+-]?[\d.,]+%)/) : null;
  if (joined) {
    const v = parseDecimal(joined[1]);
    change = Number.isFinite(v) ? v : null;
    changePercent = pct(joined[2]);
  } else if (flat) {
    change = 0;
    changePercent = pct(flat[1]);
  } else if (splitSign) {
    const v = parseDecimal(splitSign[2]);
    change = Number.isFinite(v) ? (splitSign[1] === "-" ? -v : v) : null;
    changePercent = pct(splitSign[3]);
  }

  const numAfter = (label: string) => {
    const m = t.match(new RegExp(`${label}\\s*([\\d.,]+)`));
    return m ? parseDecimal(m[1]) : null;
  };
  const rangeAfter = (label: string): [number, number] | null => {
    const m = t.match(new RegExp(`${label}\\s*([\\d.,]+)\\s*-\\s*([\\d.,]+)`));
    if (!m) return null;
    const a = parseDecimal(m[1]);
    const b = parseDecimal(m[2]);
    return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
  };

  const previousClose = numAfter("Giá\\s*đóng\\s*cửa\\s*hôm\\s*trước");
  const open = numAfter("Giá\\s*mở\\s*cửa");
  const day = rangeAfter("Biên\\s*độ\\s*ngày");
  // unit may be multi-token: "VNĐ/kg", "USD/Bbl", "Nghìn đồng/lít", "US cent/lb"
  // stop at the next section marker (% / Giá / Biên / Biến / Thay / Từ / Tổng / Cổ).
  const unitM = t.match(/Đơn\s*vị\s*tính\s*[:：]?\s*([^\s,;%]+(?:\s+(?!%|Giá|Biên|Biến|Thay|Từ|Tổng|Cổ)[^\s,;%]{1,14}){0,3})/);
  const unit = unitM ? unitM[1] : null;

  const perf: SimplizeParsed["perf"] = {};
  for (const { label, key } of PERF_KEYS) {
    const m = t.match(new RegExp(`%\\s*${label}\\s*[:：]?\\s*([+-]?[\\d.,]+%)`));
    if (m) {
      const v = pct(m[1]);
      if (v != null) perf[key] = v;
    }
  }
  // gold-world page uses "Từ đầu năm" and "1 năm" instead of "% YTD"/"% 1Y"
  if (perf.YTD == null) {
    const m = t.match(/Từ\s*đầu\s*năm\s*[:：]?\s*([+-]?[\d.,]+%)/);
    if (m) {
      const v = pct(m[1]);
      if (v != null) perf.YTD = v;
    }
  }
  if (perf["1Y"] == null) {
    const m = t.match(/1\s*năm\s*[:：]?\s*([+-]?[\d.,]+%)/);
    if (m) {
      const v = pct(m[1]);
      if (v != null) perf["1Y"] = v;
    }
  }

  // related stocks: section between "Cổ phiếu liên quan" and following section
  const relStart = t.search(/Cổ\s*phiếu\s*liên\s*quan/);
  let relText = "";
  if (relStart >= 0) {
    const tail = t.slice(relStart, relStart + 4000);
    const stop = tail.search(/Tin\s*tức\s*hàng\s*hoá|Chỉ\s*số\s*chứng\s*khoán|Tổng\s*quan/);
    relText = stop >= 0 ? tail.slice(0, stop) : tail;
  }
  const relatedStocks: string[] = [];
  if (relText) {
    const re = /\b([A-Z]{2,5})\s*\((HOSE|HNX|UPCOM)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(relText)) !== null) {
      if (!relatedStocks.includes(m[1])) relatedStocks.push(m[1]);
      if (relatedStocks.length >= 12) break;
    }
  }

  // provider-published update time (gold page: "Cập nhật lúc 12:24:17, ngày 06/09/2026")
  let timestamp: number | null = null;
  const tsM = t.match(/Cập\s*nhật\s*lúc\s*(\d{1,2}):(\d{2}):(\d{2})[,\s]+ngày\s*(\d{2})\/(\d{2})\/(\d{4})/);
  if (tsM) {
    const [, hh, mm, ss, dd, mo, yy] = tsM;
    const parsed = new Date(Number(yy), Number(mo) - 1, Number(dd), Number(hh), Number(mm), Number(ss));
    if (!Number.isNaN(parsed.getTime())) timestamp = parsed.getTime();
  }

  return {
    price,
    change,
    changePercent,
    previousClose: previousClose != null && Number.isFinite(previousClose) ? previousClose : null,
    open: open != null && Number.isFinite(open) ? open : null,
    high: day ? day[1] : null,
    low: day ? day[0] : null,
    unit,
    perf,
    relatedStocks,
    timestamp,
  };
}

/** Fetch + parse a public Simplize commodity page (SSR — real published values). */
export async function getSimplizeCommodityPage(path: string): Promise<RawCommodityQuote> {
  const base = env.simplizeBaseUrl.replace(/\/$/, "");
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await httpText(url, { provider: SIMPLIZE, timeoutMs: 9_000, retries: 1 });
  if (!res.ok || !res.text) throw new ProviderError(`simplize: ${res.error ?? "unreachable"}`, SIMPLIZE);
  const p = parseSimplizePage(res.text);
  if (!p) throw new ProviderError("simplize: page parse failed (structure changed?)", SIMPLIZE);
  // units are published on the page — map to ISO currency, never guess from slug
  const currency = currencyForUnit(p.unit);
  return {
    source: "Simplize",
    price: p.price,
    change: p.change,
    changePercent: p.changePercent,
    previousClose: p.previousClose,
    open: p.open,
    high: p.high,
    low: p.low,
    unit: p.unit,
    currency,
    perf: p.perf,
    relatedStocks: p.relatedStocks,
    timestamp: p.timestamp,
    url,
  };
}

/* ------------------------------- MSN Finance ------------------------------- */

type MsnQuote = {
  price?: number;
  priceChange?: number;
  priceChangePercent?: number;
  priceDayHigh?: number;
  priceDayLow?: number;
  timeLastTraded?: string;
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
 * SJC gold price from Vietnambiz gold board (real scraped numbers).
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
