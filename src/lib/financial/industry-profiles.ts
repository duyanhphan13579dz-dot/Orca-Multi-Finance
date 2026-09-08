import "server-only";
import { sectorOf } from "../vn/master";

/**
 * Phase 4 — Industry-specific scoring profiles.
 * Maps Vietnamese sector taxonomy → profile with weight overrides + risk flags.
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
  /** Soft thresholds used for risk flags (not hard filters). */
  flags: {
    maxDebtEquity?: number;
    minCurrentRatio?: number;
    minInterestCoverage?: number;
    preferHighLeverage?: boolean;
    note: string;
  };
}

const PROFILES: Record<IndustryProfileId, IndustryProfile> = {
  BANKING: {
    id: "BANKING",
    labelVi: "Ngân hàng",
    weights: { profitability: 0.28, liquidity: 0.1, leverage: 0.3, cashflow: 0.12, efficiency: 0.2 },
    flags: {
      preferHighLeverage: true,
      note: "Ngân hàng: đòn bẩy cao là đặc thù mô hình — ưu tiên chất lượng tài sản / NIM proxy qua sinh lời & hiệu quả.",
    },
  },
  SECURITIES: {
    id: "SECURITIES",
    labelVi: "Chứng khoán",
    weights: { profitability: 0.3, liquidity: 0.18, leverage: 0.22, cashflow: 0.15, efficiency: 0.15 },
    flags: {
      maxDebtEquity: 2.5,
      note: "Chứng khoán: biến động lợi nhuận theo thị trường — nhấn mạnh thanh khoản và đòn bẩy.",
    },
  },
  INSURANCE: {
    id: "INSURANCE",
    labelVi: "Bảo hiểm",
    weights: { profitability: 0.25, liquidity: 0.2, leverage: 0.2, cashflow: 0.2, efficiency: 0.15 },
    flags: { note: "Bảo hiểm: ưu tiên thanh khoản và dòng tiền kỹ thuật (xấp xỉ qua OCF/FCF)." },
  },
  REAL_ESTATE: {
    id: "REAL_ESTATE",
    labelVi: "Bất động sản",
    weights: { profitability: 0.22, liquidity: 0.18, leverage: 0.28, cashflow: 0.22, efficiency: 0.1 },
    flags: {
      maxDebtEquity: 1.8,
      minInterestCoverage: 1.5,
      note: "BĐS: rủi ro đòn bẩy & dòng tiền dự án — hạ điểm nếu coverage lãi vay yếu.",
    },
  },
  MANUFACTURING: {
    id: "MANUFACTURING",
    labelVi: "Sản xuất",
    weights: { profitability: 0.28, liquidity: 0.15, leverage: 0.2, cashflow: 0.22, efficiency: 0.15 },
    flags: {
      minCurrentRatio: 1.0,
      note: "Sản xuất: biên lời + vòng quay tài sản + FCF quan trọng.",
    },
  },
  RETAIL: {
    id: "RETAIL",
    labelVi: "Bán lẻ",
    weights: { profitability: 0.25, liquidity: 0.2, leverage: 0.15, cashflow: 0.2, efficiency: 0.2 },
    flags: {
      minCurrentRatio: 0.9,
      note: "Bán lẻ: vòng quay hàng tồn / phải thu và biên gộp là trọng tâm.",
    },
  },
  ENERGY: {
    id: "ENERGY",
    labelVi: "Năng lượng",
    weights: { profitability: 0.25, liquidity: 0.12, leverage: 0.25, cashflow: 0.25, efficiency: 0.13 },
    flags: {
      maxDebtEquity: 2.2,
      note: "Năng lượng: capex nặng — FCF và coverage lãi vay được nhấn mạnh.",
    },
  },
  TECHNOLOGY: {
    id: "TECHNOLOGY",
    labelVi: "Công nghệ",
    weights: { profitability: 0.32, liquidity: 0.15, leverage: 0.12, cashflow: 0.2, efficiency: 0.21 },
    flags: {
      note: "Công nghệ: ưu tiên biên lời và hiệu quả sử dụng tài sản; đòn bẩy thường thấp.",
    },
  },
  GENERAL: {
    id: "GENERAL",
    labelVi: "Đa ngành",
    weights: { profitability: 0.3, liquidity: 0.14, leverage: 0.22, cashflow: 0.22, efficiency: 0.12 },
    flags: { note: "Profile mặc định khi chưa map ngành." },
  },
};

/** Map Vietnamese sector labels → profile id. */
export function profileIdFromSector(sector: string): IndustryProfileId {
  const s = sector.toLowerCase();
  if (/ngân hàng|ngan hang|bank/.test(s)) return "BANKING";
  if (/chứng khoán|chung khoan|securit/.test(s)) return "SECURITIES";
  if (/bảo hiểm|bao hiem|insurance/.test(s)) return "INSURANCE";
  if (/bất động sản|bat dong san|bđs|real estate|khu công nghiệp/.test(s)) return "REAL_ESTATE";
  if (/bán lẻ|ban le|retail/.test(s)) return "RETAIL";
  if (/dầu khí|điện lực|năng lượng|energy|oil|gas/.test(s)) return "ENERGY";
  if (/công nghệ|cong nghe|technology|viễn thông/.test(s)) return "TECHNOLOGY";
  if (/thép|hóa chất|sản xuất|xây dựng|vật liệu|manufactur/.test(s)) return "MANUFACTURING";
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
