import "server-only";
import type { VndCompanyProfile, VndShareholder } from "../providers/vndirect-company";

/** Engine nghiên cứu DN — chỉ dùng số liệu / văn bản có trong context, không bịa. */

export type ResearchBundle = {
  valueChain: { input: string[]; process: string[]; output: string[] };
  swot: {
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
  };
  catalysts: string[];
  risks: string[];
  source: "deterministic-fs+profile";
};

function n(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function fmtMoney(v: number | null): string | null {
  if (v == null) return null;
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)} nghìn tỷ`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)} tỷ`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)} triệu`;
  return `${sign}${abs.toLocaleString("vi-VN")}`;
}

function pctStr(v: number | null): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  return `${(v * 100).toFixed(1)}%`;
}

type FinSnap = {
  revenue: number | null;
  netIncome: number | null;
  equity: number | null;
  assets: number | null;
  cash: number | null;
  debt: number | null;
  ocf: number | null;
  fcf: number | null;
  roe: number | null;
  netMargin: number | null;
  debtEquity: number | null;
  revYoy: number | null;
  niYoy: number | null;
  period: string | null;
};

function snapFromRows(
  income: Record<string, unknown>[],
  balance: Record<string, unknown>[],
  cashflow: Record<string, unknown>[],
): FinSnap {
  const i0 = income[0] ?? {};
  const i1 = income[1] ?? {};
  const b0 = balance[0] ?? {};
  const c0 = cashflow[0] ?? {};

  const rev = n(i0.netRevenue) ?? n(i0.revenue);
  const revPrev = n(i1.netRevenue) ?? n(i1.revenue);
  const ni = n(i0.netIncome) ?? n(i0.netProfit) ?? n(i0.netIncomeParent);
  const niPrev = n(i1.netIncome) ?? n(i1.netProfit) ?? n(i1.netIncomeParent);
  const equity = n(b0.equity);
  const assets = n(b0.totalAssets);
  const cash = n(b0.cash);
  const std = n(b0.shortTermDebt);
  const ltd = n(b0.longTermDebt);
  const tl = n(b0.totalLiabilities);
  const debt = std != null || ltd != null ? (std ?? 0) + (ltd ?? 0) : tl;
  const ocf = n(c0.operatingCashFlow);
  const capex = n(c0.capex) != null ? Math.abs(n(c0.capex)!) : 0;
  const fcf = n(c0.freeCashFlow) ?? (ocf != null ? ocf - capex : null);

  const period =
    typeof i0.period === "string"
      ? i0.period
      : i0.year != null && i0.quarter != null
        ? `${i0.year}-Q${i0.quarter}`
        : i0.year != null
          ? String(i0.year)
          : null;

  return {
    revenue: rev,
    netIncome: ni,
    equity,
    assets,
    cash,
    debt,
    ocf,
    fcf,
    roe: equity && ni != null && equity !== 0 ? ni / equity : null,
    netMargin: rev && ni != null && rev !== 0 ? ni / rev : null,
    debtEquity: equity && debt != null && equity !== 0 ? debt / equity : null,
    revYoy: rev != null && revPrev != null && revPrev !== 0 ? (rev - revPrev) / revPrev : null,
    niYoy: ni != null && niPrev != null && niPrev !== 0 ? (ni - niPrev) / niPrev : null,
    period,
  };
}

function detectSector(profile: VndCompanyProfile | null, symbol: string): string {
  const text = `${profile?.vnName ?? ""} ${profile?.enName ?? ""} ${profile?.vnSummary ?? ""}`.toLowerCase();
  if (/chứng khoán|securities|môi giới|broker/.test(text) || /^(SSI|VCI|SHS|CTS|ORS|BSI|FTS|AGR|TCX|VIX|DSC)$/i.test(symbol))
    return "securities";
  if (/ngân hàng|bank|nh\b/.test(text) || /^(VCB|TCB|MBB|ACB|VPB|CTG|BID|TPB|STB|HDB)$/i.test(symbol))
    return "bank";
  if (/bất động sản|real estate|địa ốc/.test(text)) return "realestate";
  if (/thép|steel/.test(text)) return "steel";
  if (/dầu|gas|xăng|oil|petro/.test(text)) return "energy";
  if (/cảng|port|logistics|vận tải/.test(text)) return "logistics";
  if (/công nghệ|technology|phần mềm|software/.test(text)) return "tech";
  return "general";
}

function valueChainForSector(sector: string, profile: VndCompanyProfile | null): ResearchBundle["valueChain"] {
  const name = profile?.vnName ?? "Doanh nghiệp";
  switch (sector) {
    case "securities":
      return {
        input: [
          "Vốn chủ sở hữu & hạn mức tự doanh",
          "Khách hàng cá nhân / tổ chức mở tài khoản",
          "Nguồn hàng chứng khoán & sản phẩm phái sinh",
        ],
        process: [
          "Môi giới cổ phiếu / phái sinh trên HOSE·HNX·UPCOM",
          "Tự doanh & tạo lập thị trường",
          "Tư vấn đầu tư, bảo lãnh phát hành, lưu ký",
        ],
        output: [
          "Phí môi giới & phí giao dịch",
          "Lãi tự doanh / đầu tư tài chính",
          "Phí tư vấn · bảo lãnh · dịch vụ lưu ký",
        ],
      };
    case "bank":
      return {
        input: ["Huy động tiền gửi khách hàng", "Vốn điều lệ & hệ số CAR", "Nguồn vốn liên ngân hàng"],
        process: ["Cho vay DN & bán lẻ", "Đầu tư trái phiếu / GTCG", "Dịch vụ thanh toán · bancassurance"],
        output: ["Thu nhập lãi thuần (NII)", "Phí dịch vụ", "Lãi đầu tư chứng khoán"],
      };
    case "realestate":
      return {
        input: ["Quỹ đất & pháp lý dự án", "Vốn vay / trái phiếu", "Nhà thầu & vật liệu"],
        process: ["Phát triển dự án", "Xây dựng · bàn giao", "Cho thuê / vận hành"],
        output: ["Doanh thu chuyển nhượng BĐS", "Doanh thu cho thuê", "Lãi liên doanh"],
      };
    default:
      return {
        input: [`Nguyên liệu / đầu vào phục vụ ${name}`, "Nhân sự & năng lực vận hành", "Vốn lưu động"],
        process: ["Sản xuất / cung ứng dịch vụ cốt lõi", "Phân phối & bán hàng", "Quản trị chi phí · chất lượng"],
        output: ["Doanh thu thuần", "Lợi nhuận sau thuế", "Dòng tiền hoạt động"],
      };
  }
}

function extractFoundYear(profile: VndCompanyProfile | null): number | null {
  const sum = profile?.vnSummary ?? "";
  const m = sum.match(/(?:thành lập|thành lập vào|năm)\s*(?:năm\s*)?(19|20)\d{2}/i);
  if (m) {
    const y = Number(m[0].match(/(19|20)\d{2}/)?.[0]);
    if (y >= 1900 && y <= 2100) return y;
  }
  if (profile?.foundDate && profile.foundDate !== "2000-01-01") {
    const y = Number(String(profile.foundDate).slice(0, 4));
    if (y >= 1900 && y <= 2100) return y;
  }
  return null;
}

/** Rút insight có căn cứ từ hồ sơ + BCTC + cổ đông */
export function buildDeterministicResearch(opts: {
  symbol: string;
  profile: VndCompanyProfile | null;
  shareholders: VndShareholder[];
  income: Record<string, unknown>[];
  balance: Record<string, unknown>[];
  cashflow: Record<string, unknown>[];
}): ResearchBundle {
  const { symbol, profile, shareholders, income, balance, cashflow } = opts;
  const fin = snapFromRows(income, balance, cashflow);
  const sector = detectSector(profile, symbol);
  const valueChain = valueChainForSector(sector, profile);
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const opportunities: string[] = [];
  const threats: string[] = [];
  const catalysts: string[] = [];
  const risks: string[] = [];

  const periodNote = fin.period ? ` (kỳ ${fin.period})` : "";

  // —— Strengths từ số liệu thật ——
  if (fin.roe != null && fin.roe >= 0.12) {
    strengths.push(`ROE ${pctStr(fin.roe)}${periodNote} — hiệu quả vốn chủ ở mức khá/cao.`);
  } else if (fin.roe != null && fin.roe > 0) {
    strengths.push(`ROE dương ${pctStr(fin.roe)}${periodNote}.`);
  }
  if (fin.netMargin != null && fin.netMargin >= 0.15) {
    strengths.push(`Biên LN ròng ${pctStr(fin.netMargin)}${periodNote}.`);
  }
  if (fin.niYoy != null && fin.niYoy > 0.1) {
    strengths.push(`LNST tăng ${pctStr(fin.niYoy)} so với kỳ trước.`);
  }
  if (fin.revYoy != null && fin.revYoy > 0.1) {
    strengths.push(`Doanh thu tăng ${pctStr(fin.revYoy)} so với kỳ trước.`);
  }
  if (fin.revenue != null) {
    strengths.push(`Doanh thu thuần ${fmtMoney(fin.revenue)}${periodNote}.`);
  }
  if (fin.netIncome != null && fin.netIncome > 0) {
    strengths.push(`LNST dương ${fmtMoney(fin.netIncome)}${periodNote}.`);
  }
  if (profile?.employees && profile.employees >= 200) {
    strengths.push(`Quy mô nhân sự ~${Math.round(profile.employees)} người.`);
  }
  const top = shareholders.filter((s) => (s.ownershipPct ?? 0) >= 5).slice(0, 3);
  if (top.length) {
    strengths.push(
      `Cổ đông lớn: ${top.map((s) => `${s.name} (${s.ownershipPct?.toFixed(1)}%)`).join("; ")}.`,
    );
  }
  if (profile?.floor) {
    strengths.push(`Niêm yết ${profile.floor}.`);
  }
  // Thị phần / xếp hạng nếu có trong summary
  const sum = profile?.vnSummary ?? "";
  const rank = sum.match(/xếp?\s*ở\s*vị\s*trí\s*(\d+)[^.]{0,80}/i);
  if (rank) strengths.push(rank[0].trim() + ".");
  const shareM = sum.match(/(\d+[.,]\d+)%\s*thị\s*phần[^.]{0,60}/gi);
  if (shareM?.length) {
    strengths.push(...shareM.slice(0, 2).map((x) => x.trim() + "."));
  }

  // —— Weaknesses ——
  if (fin.roe != null && fin.roe < 0.08 && fin.roe >= 0) {
    weaknesses.push(`ROE thấp ${pctStr(fin.roe)}${periodNote}.`);
  }
  if (fin.roe != null && fin.roe < 0) {
    weaknesses.push(`ROE âm ${pctStr(fin.roe)}${periodNote}.`);
  }
  if (fin.netIncome != null && fin.netIncome < 0) {
    weaknesses.push(`LNST âm ${fmtMoney(fin.netIncome)}${periodNote}.`);
  }
  if (fin.ocf != null && fin.ocf < 0) {
    weaknesses.push(`CFO âm ${fmtMoney(fin.ocf)}${periodNote} — lợi nhuận chưa đi kèm dòng tiền HĐKD.`);
  }
  if (fin.fcf != null && fin.fcf < 0 && fin.ocf != null && fin.ocf >= 0) {
    weaknesses.push(`FCF âm ${fmtMoney(fin.fcf)}${periodNote}.`);
  }
  if (fin.debtEquity != null && fin.debtEquity > 2) {
    weaknesses.push(`Nợ/VCSH cao ${fin.debtEquity.toFixed(2)}x.`);
  }
  if (fin.niYoy != null && fin.niYoy < -0.1) {
    weaknesses.push(`LNST giảm ${pctStr(fin.niYoy)} so với kỳ trước.`);
  }
  if (fin.revYoy != null && fin.revYoy < -0.1) {
    weaknesses.push(`Doanh thu giảm ${pctStr(fin.revYoy)} so với kỳ trước.`);
  }

  // —— Opportunities / catalysts theo ngành + số liệu ——
  if (sector === "securities") {
    opportunities.push("Thanh khoản thị trường CK phục hồi hỗ trợ phí môi giới & tự doanh.");
    opportunities.push("Phát triển sản phẩm phái sinh / trái phiếu DN / wealth management.");
    catalysts.push("Tăng thị phần môi giới trên HOSE/HNX/UPCOM.");
    catalysts.push("Mở rộng khách hàng tổ chức & margin trong khung an toàn.");
    if (fin.niYoy != null && fin.niYoy > 0) {
      catalysts.push(`Đà tăng LNST ${pctStr(fin.niYoy)} có thể duy trì nếu thanh khoản thị trường ổn định.`);
    }
  } else if (sector === "bank") {
    opportunities.push("Tín dụng phục hồi & nim ổn định hỗ trợ NII.");
    catalysts.push("Tăng trưởng tín dụng trong hạn mức NHNN.");
    catalysts.push("Cải thiện CASA / giảm chi phí vốn.");
  } else {
    opportunities.push("Mở rộng thị phần nội địa nếu nhu cầu ngành phục hồi.");
    if (fin.revYoy != null && fin.revYoy > 0) {
      catalysts.push(`Doanh thu đang tăng ${pctStr(fin.revYoy)} — theo dõi duy trì đà tăng.`);
    }
    if (fin.roe != null && fin.roe >= 0.1) {
      catalysts.push("Duy trì ROE cao kết hợp tái đầu tư hợp lý.");
    }
  }
  if (profile?.website) {
    catalysts.push(`Theo dõi cập nhật IR trên ${profile.website.replace(/^https?:\/\//, "")}.`);
  }

  // —— Threats / risks ——
  if (sector === "securities") {
    threats.push("Thanh khoản thị trường giảm làm co hẹp phí môi giới & kết quả tự doanh.");
    threats.push("Rủi ro thị trường / margin khi biến động mạnh.");
    risks.push("Biến động tự doanh có thể làm LNST dao động mạnh giữa các quý.");
    risks.push("Cạnh tranh phí môi giới giữa các CTCK lớn.");
  } else if (sector === "bank") {
    threats.push("Chất lượng tín dụng suy giảm làm tăng chi phí dự phòng.");
    risks.push("Áp lực NIM khi lãi huy động tăng.");
  } else {
    threats.push("Biến động giá đầu vào / cầu tiêu thụ ngành.");
  }
  if (fin.ocf != null && fin.ocf < 0) {
    risks.push(`CFO âm ${fmtMoney(fin.ocf)} — cần theo dõi khả năng chuyển hóa lợi nhuận thành tiền.`);
  }
  if (fin.debtEquity != null && fin.debtEquity > 1.5) {
    risks.push(`Đòn bẩy Nợ/VCSH ${fin.debtEquity.toFixed(2)}x — nhạy với lãi suất & điều kiện tín dụng.`);
  }
  if (fin.netIncome != null && fin.ocf != null && fin.netIncome > 0 && fin.ocf < 0) {
    risks.push("Lệch pha LNST dương / CFO âm — chất lượng lợi nhuận cần kiểm chứng thêm các kỳ sau.");
  }

  // Đảm bảo tối thiểu 1 mục mỗi ô nếu có profile
  if (profile && strengths.length === 0) {
    strengths.push(`${profile.vnName ?? symbol} — hồ sơ DN lấy từ VNDirect.`);
  }
  if (weaknesses.length === 0 && fin.period) {
    weaknesses.push("Chưa đủ tín hiệu yếu rõ trên BCTC kỳ gần nhất — cần theo dõi thêm.");
  }
  if (opportunities.length === 0) {
    opportunities.push("Cải thiện biên lợi nhuận và vòng quay vốn nếu ngành phục hồi.");
  }
  if (threats.length === 0) {
    threats.push("Rủi ro vĩ mô (lãi suất, tỷ giá, tăng trưởng GDP) ảnh hưởng kết quả kinh doanh.");
  }
  if (catalysts.length === 0) {
    catalysts.push("Công bố BCTC các kỳ tiếp theo và kế hoạch kinh doanh năm.");
  }
  if (risks.length === 0) {
    risks.push("Thiếu dữ liệu đủ dài để đánh giá rủi ro đặc thù — ưu tiên theo dõi BCTC và cấu trúc cổ đông.");
  }

  return {
    valueChain,
    swot: {
      strengths: strengths.slice(0, 6),
      weaknesses: weaknesses.slice(0, 5),
      opportunities: opportunities.slice(0, 4),
      threats: threats.slice(0, 4),
    },
    catalysts: catalysts.slice(0, 5),
    risks: risks.slice(0, 5),
    source: "deterministic-fs+profile",
  };
}

export function enrichFoundDate(profile: VndCompanyProfile | null): VndCompanyProfile | null {
  if (!profile) return null;
  const y = extractFoundYear(profile);
  if (!y) return profile;
  if (profile.foundDate === "2000-01-01" || !profile.foundDate) {
    return { ...profile, foundDate: `${y}-01-01` };
  }
  return profile;
}
