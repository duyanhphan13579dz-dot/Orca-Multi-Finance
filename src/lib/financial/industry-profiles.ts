import "server-only";
import { sectorOf } from "../vn/master";

/**
 * Phase 4 — Industry-specific scoring profiles (complete).
 */

export type IndustryProfileId =
  | "BANKING"
  | "SECURITIES"
  | "INSURANCE"
  | "REAL_ESTATE"
  | "MANUFACTURING"
  | "RETAIL"
  | "ENERGY"
  | "TECHNOLOGY"
  | "CONSTRUCTION"
  | "GENERAL";

export interface IndustryScoreWeights {
  profitability: number;
  liquidity: number;
  leverage: number;
  cashflow: number;
  efficiency: number;
}

export interface IndustryProfile {
  id: IndustryProfileId;
  labelVi: string;
  weights: IndustryScoreWeights;
  flags: {
    maxDebtEquity?: number;
    minCurrentRatio?: number;
    minInterestCoverage?: number;
    minRoe?: number;
    maxNetDebtEbitda?: number;
    preferHighLeverage?: boolean;
    note: string;
  };
  /** Soft ideal bands for UI guidance */
  ideal: {
    roe?: [number, number];
    netMargin?: [number, number];
    currentRatio?: [number, number];
    pe?: [number, number];
    pb?: [number, number];
    evEbitda?: [number, number];
  };
}

const PROFILES: Record<IndustryProfileId, IndustryProfile> = {
  BANKING: {
    id: "BANKING",
    labelVi: "Ngân hàng",
    weights: { profitability: 0.28, liquidity: 0.1, leverage: 0.28, cashflow: 0.12, efficiency: 0.22 },
    flags: {
      preferHighLeverage: true,
      minRoe: 0.08,
      note: "Ngân hàng: đòn bẩy cao là đặc thù — ưu tiên ROE/hiệu quả; D/E thông thường không áp dụng như DN phi tài chính.",
    },
    ideal: { roe: [0.1, 0.2], netMargin: [0.15, 0.4], pe: [8, 14], pb: [1.0, 2.2] },
  },
  SECURITIES: {
    id: "SECURITIES",
    labelVi: "Chứng khoán",
    weights: { profitability: 0.3, liquidity: 0.18, leverage: 0.22, cashflow: 0.15, efficiency: 0.15 },
    flags: {
      maxDebtEquity: 2.5,
      minCurrentRatio: 1.0,
      note: "Chứng khoán: lợi nhuận biến động theo thị trường — nhấn mạnh thanh khoản và đòn bẩy.",
    },
    ideal: { roe: [0.08, 0.25], currentRatio: [1.2, 3], pe: [10, 18], pb: [1.0, 2.5] },
  },
  INSURANCE: {
    id: "INSURANCE",
    labelVi: "Bảo hiểm",
    weights: { profitability: 0.25, liquidity: 0.22, leverage: 0.18, cashflow: 0.2, efficiency: 0.15 },
    flags: {
      minCurrentRatio: 1.0,
      note: "Bảo hiểm: ưu tiên thanh khoản và chất lượng dòng tiền.",
    },
    ideal: { roe: [0.08, 0.18], pe: [10, 16], pb: [1.0, 2.0] },
  },
  REAL_ESTATE: {
    id: "REAL_ESTATE",
    labelVi: "Bất động sản",
    weights: { profitability: 0.22, liquidity: 0.2, leverage: 0.25, cashflow: 0.2, efficiency: 0.13 },
    flags: {
      maxDebtEquity: 2.0,
      minCurrentRatio: 1.0,
      maxNetDebtEbitda: 4,
      note: "BĐS: đòn bẩy và vòng tiền dài — theo dõi Net Debt/EBITDA và thanh khoản.",
    },
    ideal: { roe: [0.08, 0.2], currentRatio: [1.0, 2.5], pe: [8, 16], pb: [0.8, 2.0], evEbitda: [6, 12] },
  },
  MANUFACTURING: {
    id: "MANUFACTURING",
    labelVi: "Sản xuất",
    weights: { profitability: 0.26, liquidity: 0.16, leverage: 0.18, cashflow: 0.22, efficiency: 0.18 },
    flags: {
      maxDebtEquity: 1.8,
      minCurrentRatio: 1.1,
      minInterestCoverage: 2,
      minRoe: 0.08,
      note: "Sản xuất: cân bằng biên lợi nhuận, vòng quay và đòn bẩy.",
    },
    ideal: { roe: [0.1, 0.22], netMargin: [0.05, 0.2], currentRatio: [1.2, 2.5], pe: [10, 18], pb: [1.2, 2.8], evEbitda: [6, 12] },
  },
  RETAIL: {
    id: "RETAIL",
    labelVi: "Bán lẻ",
    weights: { profitability: 0.24, liquidity: 0.2, leverage: 0.15, cashflow: 0.22, efficiency: 0.19 },
    flags: {
      maxDebtEquity: 1.5,
      minCurrentRatio: 0.9,
      note: "Bán lẻ: biên mỏng — nhấn mạnh vòng quay và dòng tiền.",
    },
    ideal: { netMargin: [0.02, 0.1], currentRatio: [0.9, 2], pe: [12, 22], pb: [1.5, 4.0] },
  },
  ENERGY: {
    id: "ENERGY",
    labelVi: "Năng lượng",
    weights: { profitability: 0.24, liquidity: 0.14, leverage: 0.2, cashflow: 0.26, efficiency: 0.16 },
    flags: {
      maxDebtEquity: 2.0,
      minInterestCoverage: 2,
      note: "Năng lượng: CAPEX lớn — ưu tiên FCF và coverage lãi vay.",
    },
    ideal: { roe: [0.08, 0.18], pe: [8, 15], pb: [0.9, 2.0], evEbitda: [5, 10] },
  },
  TECHNOLOGY: {
    id: "TECHNOLOGY",
    labelVi: "Công nghệ",
    weights: { profitability: 0.3, liquidity: 0.15, leverage: 0.12, cashflow: 0.2, efficiency: 0.23 },
    flags: {
      maxDebtEquity: 1.2,
      minRoe: 0.1,
      note: "Công nghệ: tăng trưởng và ROE cao — chấp nhận PE cao hơn.",
    },
    ideal: { roe: [0.12, 0.3], netMargin: [0.08, 0.25], pe: [14, 28], pb: [2.0, 5.0], evEbitda: [10, 20] },
  },
  CONSTRUCTION: {
    id: "CONSTRUCTION",
    labelVi: "Xây dựng",
    weights: { profitability: 0.22, liquidity: 0.2, leverage: 0.22, cashflow: 0.2, efficiency: 0.16 },
    flags: {
      maxDebtEquity: 2.0,
      minCurrentRatio: 1.0,
      note: "Xây dựng: vòng vốn lưu động quan trọng — theo dõi thanh khoản và nợ.",
    },
    ideal: { roe: [0.08, 0.18], currentRatio: [1.0, 2.0], pe: [8, 16], pb: [0.8, 2.0] },
  },
  GENERAL: {
    id: "GENERAL",
    labelVi: "Chung",
    weights: { profitability: 0.25, liquidity: 0.18, leverage: 0.18, cashflow: 0.2, efficiency: 0.19 },
    flags: {
      maxDebtEquity: 1.8,
      minCurrentRatio: 1.1,
      minInterestCoverage: 2,
      minRoe: 0.08,
      note: "Hồ sơ chung cho doanh nghiệp phi tài chính.",
    },
    ideal: { roe: [0.08, 0.2], currentRatio: [1.1, 2.5], pe: [10, 18], pb: [1.0, 2.5], evEbitda: [6, 12] },
  },
};

const SECTOR_TO_PROFILE: Record<string, IndustryProfileId> = {
  "Ngân hàng": "BANKING",
  "Chứng khoán": "SECURITIES",
  "Bảo hiểm": "INSURANCE",
  "Bất động sản": "REAL_ESTATE",
  "Bán lẻ": "RETAIL",
  "Dầu khí": "ENERGY",
  "Điện lực": "ENERGY",
  "Công nghệ": "TECHNOLOGY",
  "Thép": "MANUFACTURING",
  "Xây dựng & Vật liệu": "CONSTRUCTION",
  "Thực phẩm & Đồ uống": "MANUFACTURING",
};

export function getIndustryProfile(symbol: string): IndustryProfile {
  const sector = sectorOf(symbol);
  const id = (sector && SECTOR_TO_PROFILE[sector]) || "GENERAL";
  return PROFILES[id] ?? PROFILES.GENERAL;
}

/** Midpoint of ideal PE/PB/EV band — soft fair multiples when peers/hist missing. */
export function industryFairMultiples(symbol: string): {
  fairPe: number | null;
  fairPb: number | null;
  fairEvEbitda: number | null;
  profileId: IndustryProfileId;
  labelVi: string;
} {
  const p = getIndustryProfile(symbol);
  const mid = (b?: [number, number]) =>
    b && b.length === 2 && b[0]! > 0 && b[1]! > 0 ? (b[0]! + b[1]!) / 2 : null;
  return {
    fairPe: mid(p.ideal.pe),
    fairPb: mid(p.ideal.pb),
    fairEvEbitda: mid(p.ideal.evEbitda),
    profileId: p.id,
    labelVi: p.labelVi,
  };
}

/** Enumerate available scoring profiles for settings and API consumers. */
export function listIndustryProfiles(): IndustryProfile[] { return Object.values(PROFILES); }

/** Resolve a known Vietnamese sector label to its scoring profile. */
export function profileIdFromSector(sector: string | null | undefined): IndustryProfileId {
  return sector ? SECTOR_TO_PROFILE[sector] ?? "GENERAL" : "GENERAL";
}
