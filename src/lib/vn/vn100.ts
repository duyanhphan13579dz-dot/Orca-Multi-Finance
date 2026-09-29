/**
 * VN100 — 100 cổ phiếu thanh khoản & vốn hóa hàng đầu HOSE.
 * Nguồn tham chiếu: HOSE / DNSE (cập nhật ~10/2025), bổ sung mã liquid phổ biến.
 * Dùng làm universe mặc định cho quét mẫu nến + phân kỳ (ưu tiên tín hiệu mới nhất).
 *
 * Lưu ý: rổ chính thức điều chỉnh định kỳ (thường T1/T7). Danh sách tĩnh — cập nhật tay khi HOSE công bố.
 */

/** Full VN100-oriented universe (≈100 mã). */
export const VN100: readonly string[] = [
  // Ngân hàng
  "VCB", "BID", "CTG", "TCB", "MBB", "VPB", "ACB", "STB", "HDB", "VIB",
  "TPB", "SHB", "MSB", "OCB", "LPB", "EIB", "SSB", "NAB",
  // BĐS / KCN
  "VIC", "VHM", "VRE", "NVL", "PDR", "DXG", "KDH", "NLG", "DIG", "HDG",
  "BCM", "KBC", "SZC", "VGC", "VPI", "HDC", "SJS", "SIP", "CII",
  // Thép / VLXD
  "HPG", "HSG", "NKG", "HT1",
  // Công nghệ / bán lẻ
  "FPT", "CMG", "MWG", "PNJ", "FRT", "DGW",
  // Thực phẩm / tiêu dùng
  "VNM", "MSN", "SAB", "MCH", "DBC", "VHC", "SBT", "KDC", "PAN", "ANV",
  // Năng lượng / tiện ích
  "GAS", "PLX", "POW", "REE", "GEX", "NT2", "PC1", "PPC", "BWE",
  // Dầu khí dịch vụ
  "PVD", "PVT",
  // Chứng khoán / tài chính
  "SSI", "VND", "HCM", "VCI", "CTS", "BSI", "FTS", "VIX", "DSE", "EVF",
  // Bảo hiểm / hàng không / logistics
  "BVH", "VJC", "GMD", "VSC", "SCS",
  // Hóa chất / cao su / khác
  "DGC", "DPM", "DCM", "GVR", "PHR", "HAG", "BMP", "CTD", "CTR", "HHV",
  "IMP", "KOS", "PTB", "TCH", "TLG", "VCG", "VTP", "GEE", "DXS",
] as const;

export const VN100_SET = new Set(VN100.map((s) => s.toUpperCase()));

export function isVn100(symbol: string): boolean {
  return VN100_SET.has(symbol.trim().toUpperCase());
}

/** Universe mặc định cho screener kỹ thuật (nến / phân kỳ). */
export function defaultTechnicalUniverse(cap = 100): string[] {
  return VN100.slice(0, Math.min(cap, VN100.length)).map((s) => s.toUpperCase());
}
