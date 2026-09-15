/** IPO / niêm yết 2025–2026 — merge vào static master để search tức thì */
export const VN_IPO_SEEDS: {
  symbol: string;
  name: string;
  exchange: "HOSE" | "HNX" | "UPCOM";
  sector: string;
}[] = [
  { symbol: "TCX", name: "Chứng khoán Techcombank (TCBS)", exchange: "HOSE", sector: "Chứng khoán" },
  { symbol: "VPX", name: "Chứng khoán VPBank (VPBankS)", exchange: "HOSE", sector: "Chứng khoán" },
  { symbol: "VCK", name: "Chứng khoán VPS", exchange: "HOSE", sector: "Chứng khoán" },
  { symbol: "HPA", name: "Nông nghiệp Hòa Phát", exchange: "HOSE", sector: "Nông nghiệp" },
  { symbol: "DMX", name: "Điện Máy Xanh", exchange: "HOSE", sector: "Bán lẻ" },
  { symbol: "VPL", name: "Vinpearl", exchange: "HOSE", sector: "Du lịch & Giải trí" },
  { symbol: "TAL", name: "Taseco Land", exchange: "HOSE", sector: "Bất động sản" },
  { symbol: "CRV", name: "CRV Real Estate", exchange: "HOSE", sector: "Bất động sản" },
];

/** Accept HOSE/HNX/UPCOM ticker shape even if not in static list */
export function looksLikeVnTicker(symbol: string): boolean {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z]{2,10}\d{0,2}$/.test(s) && s.length >= 2 && s.length <= 12;
}
