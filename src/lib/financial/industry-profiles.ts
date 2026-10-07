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
    ideal: { roe: [0.1, 0.2], netMargin: [0.15, 0.4] },
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
    ideal: { roe: [0.08, 0.25], currentRatio: [1.2, 3] },
  },
  INSURANCE: {
    id: "INSURANCE",
    labelVi: "Bảo hiểm",
    weights: { profitability: 0.25, liquidity: 0.22, leverage: 0.18, cashflow: 0.2, efficiency: 0.15 },
    flags: {
      minCurrentRatio: 1.0,
      note: "Bảo hiểm: ưu tiên thanh khoản và chất lượng dòng tiền.",
    },
    ideal: { roe: [0.08, 0.18] },
  },
  REAL_ESTATE: {
    id: "REAL_ESTATE",
    labelVi: "Bất động sản",
    weights: { profitability: 0.2, liquidity: 0.18, leverage: 0.3, cashflow: 0.24, efficiency: 0.08 },
    flags: {
      maxDebtEquity: 1.8,
      minInterestCoverage: 1.5,
      maxNetDebtEbitda: 5,
      note: "BĐS: rủi ro đòn bẩy & dòng tiền dự án — coverage lãi vay và FCF quan trọng.",
    },
    ideal: { roe: [0.08, 0.2], currentRatio: [1.0, 2.5] },
  },
  MANUFACTURING: {
    id: "MANUFACTURING",
    labelVi: "Sản xuất",
    weights: { profitability: 0.28, liquidity: 0.15, leverage: 0.2, cashflow: 0.22, efficiency: 0.15 },
    flags: {
      minCurrentRatio: 1.0,
      maxDebtEquity: 1.5,
      minInterestCoverage: 2,
      note: "Sản xuất: biên lời + vòng quay tài sản + FCF.",
    },
    ideal: { roe: [0.1, 0.22], netMargin: [0.05, 0.2], currentRatio: [1.2, 2.5] },
  },
  RETAIL: {
    id: "RETAIL",
    labelVi: "Bán lẻ",
    weights: { profitability: 0.25, liquidity: 0.2, leverage: 0.15, cashflow: 0.2, efficiency: 0.2 },
    flags: {
      minCurrentRatio: 0.9,
      maxDebtEquity: 1.5,
      note: "Bán lẻ: vòng quay hàng tồn / phải thu và biên gộp.",
    },
    ideal: { netMargin: [0.02, 0.1], currentRatio: [0.9, 2] },
  },
  ENERGY: {
    id: "ENERGY",
    labelVi: "Năng lượng",
    weights: { profitability: 0.24, liquidity: 0.12, leverage: 0.26, cashflow: 0.26, efficiency: 0.12 },
    flags: {
      maxDebtEquity: 2.2,
      minInterestCoverage: 2,
      maxNetDebtEbitda: 4,
      note: "Năng lượng: capex nặng — FCF và coverage lãi vay được nhấn mạnh.",
    },
    ideal: { roe: [0.08, 0.18] },
  },
  TECHNOLOGY: {
    id: "TECHNOLOGY",
    labelVi: "Công nghệ",
    weights: { profitability: 0.32, liquidity: 0.15, leverage: 0.12, cashflow: 0.2, efficiency: 0.21 },
    flags: {
      maxDebtEquity: 1.0,
      minRoe: 0.1,
      note: "Công nghệ: ưu tiên biên lời và hiệu quả tài sản; đòn bẩy thường thấp.",
    },
    ideal: { roe: [0.12, 0.3], netMargin: [0.08, 0.25] },
  },
  CONSTRUCTION: {
    id: "CONSTRUCTION",
    labelVi: "Xây dựng",
    weights: { profitability: 0.22, liquidity: 0.18, leverage: 0.25, cashflow: 0.25, efficiency: 0.1 },
    flags: {
      maxDebtEquity: 2.0,
      minInterestCoverage: 1.5,
      minCurrentRatio: 1.0,
      note: "Xây dựng: vòng vốn lưu động dài — theo dõi nợ và OCF.",
    },
    ideal: { roe: [0.08, 0.18], currentRatio: [1.0, 2.0] },
  },
  GENERAL: {
    id: "GENERAL",
    labelVi: "Đa ngành",
    weights: { profitability: 0.3, liquidity: 0.14, leverage: 0.22, cashflow: 0.22, efficiency: 0.12 },
    flags: {
      maxDebtEquity: 2.0,
      minCurrentRatio: 1.0,
      minInterestCoverage: 2,
      note: "Profile mặc định khi chưa map ngành chuyên biệt.",
    },
    ideal: { roe: [0.08, 0.2], currentRatio: [1.1, 2.5] },
  },
};

export function profileIdFromSector(sector: string): IndustryProfileId {
  const s = sector.toLowerCase();
  if (/ngân hàng|ngan hang|bank/.test(s)) return "BANKING";
  if (/chứng khoán|chung khoan|securit/.test(s)) return "SECURITIES";
  if (/bảo hiểm|bao hiem|insurance/.test(s)) return "INSURANCE";
  if (/bất động sản|bat dong san|bđs|real estate|khu công nghiệp/.test(s)) return "REAL_ESTATE";
  if (/bán lẻ|ban le|retail/.test(s)) return "RETAIL";
  if (/dầu khí|điện lực|năng lượng|energy|oil|gas/.test(s)) return "ENERGY";
  if (/công nghệ|cong nghe|technology|viễn thông/.test(s)) return "TECHNOLOGY";
  if (/xây dựng|xay dung|construction/.test(s)) return "CONSTRUCTION";
  if (/thép|hóa chất|sản xuất|vật liệu|manufactur/.test(s)) return "MANUFACTURING";
  return "GENERAL";
}

export function getIndustryProfile(symbol: string): IndustryProfile {
  const sector = sectorOf(symbol);
  const id = profileIdFromSector(sector);
  return PROFILES[id];
}

export function listIndustryProfiles(): IndustryProfile[] {
  return Object.values(PROFILES);
}
