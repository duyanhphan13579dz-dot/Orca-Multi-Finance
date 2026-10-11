import { ok } from "@/lib/envelope";
import { cached } from "@/lib/cache";
import { httpJson } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export interface CommodityFutureItem {
  symbol: string;
  chartSymbol: string;
  nameVi: string;
  nameEn: string;
  group: "energy" | "precious_metals" | "industrial_metals" | "agriculture";
  groupVi: string;
  exchange: string;
  contractSize: string;
  unit: string;
  tickSize: string;
  marginUsd: string;
  marginVndEstimate: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
}

const COMMODITY_DEFS: Omit<
  CommodityFutureItem,
  "price" | "change" | "changePercent" | "volume" | "high" | "low" | "prevClose"
>[] = [
  {
    symbol: "CL=F",
    chartSymbol: "CL=F",
    nameVi: "Dầu thô WTI (Light Sweet)",
    nameEn: "Crude Oil WTI Futures",
    group: "energy",
    groupVi: "Năng lượng",
    exchange: "NYMEX",
    contractSize: "1,000 Thùng (Barrels)",
    unit: "USD/thùng",
    tickSize: "0.01 USD ($10/tick)",
    marginUsd: "~6,500 USD",
    marginVndEstimate: "~165 triệu VNĐ",
  },
  {
    symbol: "BZ=F",
    chartSymbol: "BZ=F",
    nameVi: "Dầu thô Brent Biển Bắc",
    nameEn: "Brent Crude Futures",
    group: "energy",
    groupVi: "Năng lượng",
    exchange: "ICE",
    contractSize: "1,000 Thùng (Barrels)",
    unit: "USD/thùng",
    tickSize: "0.01 USD ($10/tick)",
    marginUsd: "~7,200 USD",
    marginVndEstimate: "~183 triệu VNĐ",
  },
  {
    symbol: "NG=F",
    chartSymbol: "NG=F",
    nameVi: "Khí tự nhiên (Natural Gas)",
    nameEn: "Natural Gas Futures",
    group: "energy",
    groupVi: "Năng lượng",
    exchange: "NYMEX",
    contractSize: "10,000 MMBtu",
    unit: "USD/MMBtu",
    tickSize: "0.001 USD ($10/tick)",
    marginUsd: "~4,500 USD",
    marginVndEstimate: "~114 triệu VNĐ",
  },
  {
    symbol: "GC=F",
    chartSymbol: "GC=F",
    nameVi: "Vàng Tương lai (Gold COMEX)",
    nameEn: "Gold Futures",
    group: "precious_metals",
    groupVi: "Kim loại quý",
    exchange: "COMEX",
    contractSize: "100 Troy Ounces (~82.9 cây)",
    unit: "USD/oz",
    tickSize: "0.10 USD ($10/tick)",
    marginUsd: "~11,000 USD",
    marginVndEstimate: "~279 triệu VNĐ",
  },
  {
    symbol: "SI=F",
    chartSymbol: "SI=F",
    nameVi: "Bạc Tương lai (Silver COMEX)",
    nameEn: "Silver Futures",
    group: "precious_metals",
    groupVi: "Kim loại quý",
    exchange: "COMEX",
    contractSize: "5,000 Troy Ounces",
    unit: "USD/oz",
    tickSize: "0.005 USD ($25/tick)",
    marginUsd: "~9,500 USD",
    marginVndEstimate: "~241 triệu VNĐ",
  },
  {
    symbol: "HG=F",
    chartSymbol: "HG=F",
    nameVi: "Đồng Tương lai (Copper COMEX)",
    nameEn: "Copper Futures",
    group: "industrial_metals",
    groupVi: "Kim loại công nghiệp",
    exchange: "COMEX",
    contractSize: "25,000 Pounds (~11.3 tấn)",
    unit: "USD/lb",
    tickSize: "0.0005 USD ($12.5/tick)",
    marginUsd: "~5,800 USD",
    marginVndEstimate: "~147 triệu VNĐ",
  },
  {
    symbol: "ZC=F",
    chartSymbol: "ZC=F",
    nameVi: "Ngô Tương lai (Corn CBOT)",
    nameEn: "Corn Futures",
    group: "agriculture",
    groupVi: "Nông sản",
    exchange: "CBOT",
    contractSize: "5,000 Giạ (Bushels, ~127 tấn)",
    unit: "US Cents/giạ",
    tickSize: "0.25 Cents ($12.5/tick)",
    marginUsd: "~1,800 USD",
    marginVndEstimate: "~45.7 triệu VNĐ",
  },
  {
    symbol: "ZS=F",
    chartSymbol: "ZS=F",
    nameVi: "Đậu tương Tương lai (Soybeans CBOT)",
    nameEn: "Soybeans Futures",
    group: "agriculture",
    groupVi: "Nông sản",
    exchange: "CBOT",
    contractSize: "5,000 Giạ (Bushels, ~136 tấn)",
    unit: "US Cents/giạ",
    tickSize: "0.25 Cents ($12.5/tick)",
    marginUsd: "~2,900 USD",
    marginVndEstimate: "~73.6 triệu VNĐ",
  },
  {
    symbol: "ZW=F",
    chartSymbol: "ZW=F",
    nameVi: "Lúa mì Tương lai (Wheat CBOT)",
    nameEn: "Wheat Futures",
    group: "agriculture",
    groupVi: "Nông sản",
    exchange: "CBOT",
    contractSize: "5,000 Giạ (Bushels, ~136 tấn)",
    unit: "US Cents/giạ",
    tickSize: "0.25 Cents ($12.5/tick)",
    marginUsd: "~2,400 USD",
    marginVndEstimate: "~61 triệu VNĐ",
  },
];

async function fetchYahooQuote(symbol: string) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
    const res = await httpJson<{ chart?: { result?: Array<{ meta?: Record<string, unknown> }> } }>(url, {
      provider: "yahoo",
      timeoutMs: 4000,
      retries: 1,
    });
    if (res.ok && res.data?.chart?.result?.[0]?.meta) {
      const m = res.data.chart.result[0].meta;
      const price = typeof m.regularMarketPrice === "number" ? m.regularMarketPrice : null;
      const prevClose = typeof m.chartPreviousClose === "number" ? m.chartPreviousClose : null;
      const change = typeof m.fulldayChange === "number"
        ? m.fulldayChange
        : price != null && prevClose != null
          ? price - prevClose
          : null;
      const changePercent = typeof m.regularMarketChangePercent === "number"
        ? m.regularMarketChangePercent
        : price != null && prevClose != null && prevClose > 0
          ? ((price - prevClose) / prevClose) * 100
          : null;
      const volume = typeof m.regularMarketVolume === "number" ? m.regularMarketVolume : null;
      const high = typeof m.regularMarketDayHigh === "number" ? m.regularMarketDayHigh : null;
      const low = typeof m.regularMarketDayLow === "number" ? m.regularMarketDayLow : null;
      return { price, change, changePercent, volume, high, low, prevClose };
    }
  } catch {
    // fallback
  }
  return { price: null, change: null, changePercent: null, volume: null, high: null, low: null, prevClose: null };
}

/**
 * GET /api/v1/derivatives/commodities
 * Danh mục hợp đồng tương lai hàng hóa quốc tế liên thông giao dịch (MXV, CME, ICE, CBOT).
 */
export async function GET() {
  const cachedData = await cached("derivatives:commodities_contracts", {
    ttlMs: 30_000,
    staleMs: 120_000,
    producer: async () => {
      const quotes = await Promise.all(
        COMMODITY_DEFS.map(async (def) => {
          const q = await fetchYahooQuote(def.symbol);
          return {
            ...def,
            ...q,
          };
        }),
      );
      return quotes;
    },
  });

  return ok(cachedData.value, {
    source: "yahoo+mxv",
    sourceTimestampMs: Date.now(),
    cached: cachedData.cached,
    stale: false,
    note: "Hàng hóa phái sinh quốc tế liên thông MXV (CME, ICE, CBOT)",
  });
}
