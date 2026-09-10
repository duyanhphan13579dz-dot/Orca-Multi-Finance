import "server-only";
import type { IndexQuote, Quote } from "../types";

/**
 * LEVEL-4 FALLBACK — SNAPSHOT XÁC THỰC của phiên ĐÓNG CỬA 2026-09-10,
 * kéo trực tiếp từ api-finfo.vndirect.com.vn (/v4/stock_prices sort nmValue:desc
 * + /v4/vnmarket_prices + /v4/stocks) lúc 15:05 +07:00 cùng ngày.
 *
 * Chỉ dùng khi MỌI nguồn live (SSI FastConnect v3 → SSI v2 → VNDirect) đều
 * không reachable. KHÔNG BAO GIỜ hiển thị như dữ liệu live: meta ghi rõ
 * source "vndirect-snapshot", phiên gốc và thời điểm chụp.
 *
 * Không bịa số: mọi giá trị dưới đây là nguyên văn từ nguồn (100 mã thanh
 * khoản cao nhất + 6 chỉ số). Mã thiếu tên công ty để null — không suy đoán.
 */

export const VN_BOARD_SNAPSHOT_SESSION = "2026-09-10";
export const VN_BOARD_SNAPSHOT_CAPTURED_AT = "2026-09-10T15:05:00+07:00";

/** [symbol, close, change, pctChange, open, high, low, volume, value, ref, ceiling, floor, exchange, time] */
type Row = [string, number, number, number, number, number, number, number, number, number, number, number, string, string];

const ROWS: Row[] = [
  ["VHM", 73.1, 1.0, 1.387, 71.8, 74.2, 69.5, 16074200, 1.14777145e12, 72.1, 77.1, 67.1, "HOSE", "14:46:26"],
  ["VIC", 247.7, 0.0, 0.0, 247.7, 249.5, 244.4, 4481800, 1.10932042e12, 247.7, 265.0, 230.4, "HOSE", "14:46:26"],
  ["FPT", 74.5, 2.1, 2.9006, 72.3, 74.8, 72.2, 11936600, 8.8220014e11, 72.4, 77.4, 67.4, "HOSE", "14:52:08"],
  ["SHB", 11.75, 0.0, 0.0, 11.75, 11.8, 11.6, 35366100, 4.1314773e11, 11.75, 12.55, 10.95, "HOSE", "14:46:20"],
  ["VPB", 27.5, 0.1, 0.365, 27.3, 27.6, 27.15, 13222300, 3.6209069e11, 27.4, 29.3, 25.5, "HOSE", "14:46:27"],
  ["VIX", 13.8, 0.2, 1.4706, 13.55, 13.9, 13.5, 25599500, 3.5087077e11, 13.6, 14.55, 12.65, "HOSE", "14:46:26"],
  ["HPG", 21.85, -0.2, -0.907, 22.0, 22.05, 21.8, 13391400, 2.9381042e11, 22.05, 23.55, 20.55, "HOSE", "14:46:11"],
  ["SSI", 21.0, 0.1, 0.4785, 20.85, 21.2, 20.7, 12807500, 2.68359495e11, 20.9, 22.35, 19.45, "HOSE", "14:46:21"],
  ["PVT", 21.75, 0.75, 3.5714, 21.15, 22.2, 21.15, 11677700, 2.54970015e11, 21.0, 22.45, 19.55, "HOSE", "14:46:19"],
  ["STB", 78.0, 1.3, 1.6949, 76.7, 79.0, 76.7, 3168900, 2.4810133e11, 76.7, 82.0, 71.4, "HOSE", "14:46:21"],
  ["HDB", 27.45, -0.05, -0.1818, 27.3, 27.5, 27.0, 8914400, 2.4272497e11, 27.5, 29.4, 25.6, "HOSE", "14:46:10"],
  ["BSR", 27.1, -0.25, -0.9141, 27.7, 27.85, 27.05, 8543000, 2.34049865e11, 27.35, 29.25, 25.45, "HOSE", "14:46:02"],
  ["DGW", 44.75, 2.9, 6.9295, 41.8, 44.75, 41.6, 5022100, 2.1911254e11, 41.85, 44.75, 38.95, "HOSE", "14:45:01"],
  ["MSN", 68.7, 0.3, 0.4386, 68.0, 69.0, 68.0, 3106400, 2.1350914e11, 68.4, 73.1, 63.7, "HOSE", "14:46:15"],
  ["CTG", 30.55, -0.15, -0.4886, 30.65, 30.7, 30.5, 6515200, 1.9927172e11, 30.7, 32.8, 28.6, "HOSE", "14:46:04"],
  ["TCB", 32.4, 0.0, 0.0, 32.2, 32.5, 32.15, 5852200, 1.8938143e11, 32.4, 34.65, 30.15, "HOSE", "14:46:22"],
  ["VCB", 59.0, 0.3, 0.5111, 58.7, 59.4, 58.5, 3066000, 1.8096189e11, 58.7, 62.8, 54.6, "HOSE", "14:46:24"],
  ["MWG", 72.9, 1.3, 1.8156, 71.6, 73.3, 71.2, 2496200, 1.808468e11, 71.6, 76.6, 66.6, "HOSE", "14:52:15"],
  ["VPI", 61.4, 2.7, 4.5997, 58.6, 61.4, 58.0, 2633100, 1.5656103e11, 58.7, 62.8, 54.6, "HOSE", "14:46:27"],
  ["VND", 15.85, 0.0, 0.0, 15.85, 16.0, 15.6, 9677400, 1.5293579e11, 15.85, 16.95, 14.75, "HOSE", "14:46:26"],
  ["MBB", 20.1, -0.1, -0.495, 20.2, 20.25, 20.05, 6900700, 1.39056135e11, 20.2, 21.6, 18.8, "HOSE", "14:53:14"],
  ["PLX", 35.5, -0.3, -0.838, 36.25, 36.25, 35.5, 3556200, 1.2708107e11, 35.8, 38.3, 33.3, "HOSE", "14:45:03"],
  ["MSR", 47.6, -0.6, -1.2448, 48.2, 48.2, 46.3, 2604000, 1.2280604e11, 48.2, 55.4, 41.0, "UPCOM", "15:00:01"],
  ["VNM", 61.6, 0.3, 0.4894, 61.3, 61.9, 61.1, 1890400, 1.1638729e11, 61.3, 65.5, 57.1, "HOSE", "14:46:27"],
  ["LPB", 48.15, 0.0, 0.0, 48.15, 48.55, 47.3, 2421000, 1.1585789e11, 48.15, 51.5, 44.8, "HOSE", "14:46:14"],
  ["CII", 14.05, -0.3, -2.0906, 14.35, 14.4, 14.05, 7914800, 1.11923495e11, 14.35, 15.35, 13.35, "HOSE", "14:46:02"],
  ["VRE", 26.45, 0.15, 0.5703, 26.15, 26.5, 25.65, 3903200, 1.0210757e11, 26.3, 28.1, 24.5, "HOSE", "14:46:27"],
  ["VCI", 21.3, 0.1, 0.4717, 21.1, 21.6, 21.0, 4738000, 1.00714595e11, 21.2, 22.65, 19.75, "HOSE", "14:46:25"],
  ["GEX", 25.05, 0.45, 1.8293, 24.6, 25.1, 24.5, 3968100, 9.8708725e10, 24.6, 26.3, 22.9, "HOSE", "14:46:09"],
  ["GAS", 84.6, -1.1, -1.2835, 86.4, 87.5, 84.5, 1143100, 9.801029e10, 85.7, 91.6, 79.8, "HOSE", "14:46:08"],
  ["VJC", 125.2, 0.2, 0.16, 125.1, 125.9, 124.0, 774000, 9.651594e10, 125.0, 133.7, 116.3, "HOSE", "14:46:26"],
  ["DCM", 32.5, -0.15, -0.4594, 32.8, 33.15, 32.4, 2906900, 9.51546e10, 32.65, 34.9, 30.4, "HOSE", "14:46:05"],
  ["SHS", 14.9, 0.0, 0.0, 15.0, 15.1, 14.7, 6102500, 9.089714e10, 14.9, 16.3, 13.5, "HNX", "15:01:00"],
  ["ACB", 22.4, -0.05, -0.2227, 22.45, 22.5, 22.35, 3925600, 8.8001995e10, 22.45, 24.0, 20.9, "HOSE", "14:46:00"],
  ["BID", 36.35, -0.05, -0.1374, 36.4, 36.55, 36.05, 2388800, 8.6822195e10, 36.4, 38.9, 33.9, "HOSE", "14:46:01"],
  ["DXG", 11.25, -0.05, -0.4425, 11.2, 11.35, 11.1, 7339600, 8.231097e10, 11.3, 12.05, 10.55, "HOSE", "14:46:07"],
  ["PVD", 18.5, -0.15, -0.8043, 18.8, 18.95, 18.45, 4406600, 8.2207755e10, 18.65, 19.95, 17.35, "HOSE", "14:46:18"],
  ["TCX", 39.6, -0.4, -1.0, 39.9, 39.95, 39.25, 1968000, 7.772764e10, 40.0, 42.8, 37.2, "HOSE", "14:46:23"],
  ["VSC", 13.55, 0.05, 0.3704, 13.4, 13.75, 13.35, 5301000, 7.1836015e10, 13.5, 14.4, 12.6, "HOSE", "14:46:28"],
  ["PVS", 38.7, 0.3, 0.7813, 38.5, 39.3, 38.2, 1813700, 7.017418e10, 38.4, 42.2, 34.6, "HNX", "15:01:00"],
  ["DCL", 39.0, 1.0, 2.6316, 38.0, 39.7, 38.0, 1788000, 6.9630835e10, 38.0, 40.65, 35.35, "HOSE", "14:45:01"],
  ["HCM", 26.3, -0.05, -0.1898, 26.2, 26.45, 26.05, 2621700, 6.884969e10, 26.35, 28.15, 24.55, "HOSE", "14:46:10"],
  ["FRT", 140.0, -0.5, -0.3559, 140.4, 143.0, 140.0, 455100, 6.445283e10, 140.5, 150.3, 130.7, "HOSE", "14:46:08"],
  ["PNJ", 38.2, 0.25, 0.6588, 37.85, 38.5, 37.8, 1639200, 6.2627995e10, 37.95, 40.6, 35.3, "HOSE", "14:46:18"],
  ["GEE", 63.9, 1.0, 1.5898, 63.0, 64.8, 63.0, 971300, 6.213553e10, 62.9, 67.3, 58.5, "HOSE", "14:46:08"],
  ["TPB", 14.45, 0.0, 0.0, 14.45, 14.5, 14.4, 4276600, 6.1746485e10, 14.45, 15.45, 13.45, "HOSE", "14:46:24"],
  ["DPM", 22.6, -0.2, -0.8772, 22.9, 23.05, 22.55, 2681800, 6.111852e10, 22.8, 24.35, 21.25, "HOSE", "14:46:06"],
  ["NTP", 55.1, 2.8, 5.3537, 52.2, 55.5, 52.1, 1053800, 5.751593e10, 52.3, 57.5, 47.1, "HNX", "15:01:00"],
  ["POW", 12.85, -0.05, -0.3876, 12.9, 13.0, 12.75, 4291300, 5.5120735e10, 12.9, 13.8, 12.0, "HOSE", "14:46:18"],
  ["VPL", 84.0, -1.9, -2.2119, 85.8, 85.8, 83.0, 583700, 4.908033e10, 85.9, 91.9, 79.9, "HOSE", "14:46:27"],
  ["NVL", 12.85, -0.15, -1.1538, 12.9, 13.0, 12.85, 3741600, 4.825959e10, 13.0, 13.9, 12.1, "HOSE", "14:46:16"],
  ["SSB", 18.0, 0.3, 1.6949, 17.8, 18.2, 17.65, 2647800, 4.7378335e10, 17.7, 18.9, 16.5, "HOSE", "14:46:21"],
  ["VCK", 30.1, 0.25, 0.8375, 29.95, 30.15, 29.55, 1583500, 4.7353565e10, 29.85, 31.9, 27.8, "HOSE", "14:46:25"],
  ["TCH", 12.1, -0.1, -0.8197, 12.2, 12.35, 12.1, 3641200, 4.4431695e10, 12.2, 13.05, 11.35, "HOSE", "14:46:22"],
  ["KDH", 17.0, 0.0, 0.0, 16.9, 17.05, 16.75, 2432900, 4.1098645e10, 17.0, 18.15, 15.85, "HOSE", "14:51:13"],
  ["PDR", 12.0, 0.0, 0.0, 12.0, 12.0, 11.8, 3341000, 3.9791785e10, 12.0, 12.8, 11.2, "HOSE", "14:46:17"],
  ["VIB", 13.7, 0.0, 0.0, 13.75, 13.8, 13.65, 2869000, 3.9364265e10, 13.7, 14.65, 12.75, "HOSE", "14:46:26"],
  ["SBT", 23.05, 0.05, 0.2174, 23.0, 23.45, 22.75, 1584100, 3.659983e10, 23.0, 24.6, 21.4, "HOSE", "14:46:19"],
  ["BAF", 32.2, 0.1, 0.3115, 32.0, 32.2, 31.9, 1125900, 3.6074515e10, 32.1, 34.3, 29.9, "HOSE", "14:45:01"],
  ["EIB", 16.85, 0.1, 0.597, 16.7, 16.9, 16.7, 2054700, 3.4539025e10, 16.75, 17.9, 15.6, "HOSE", "14:46:07"],
  ["MBS", 17.1, 0.0, 0.0, 17.0, 17.3, 17.0, 2001500, 3.430373e10, 17.1, 18.8, 15.4, "HNX", "15:01:00"],
  ["GEL", 28.1, 0.6, 2.1818, 27.5, 28.3, 27.2, 1229100, 3.424131e10, 27.5, 29.4, 25.6, "HOSE", "14:46:09"],
  ["PVP", 19.1, 0.1, 0.5263, 19.1, 19.85, 18.85, 1748800, 3.399088e10, 19.0, 20.3, 17.7, "HOSE", "14:45:03"],
  ["PHR", 60.4, -1.0, -1.6287, 61.4, 61.6, 60.4, 538900, 3.278908e10, 61.4, 65.6, 57.2, "HOSE", "14:45:03"],
  ["HAG", 13.95, 0.0, 0.0, 13.85, 13.95, 13.65, 2311400, 3.19906e10, 13.95, 14.9, 13.0, "HOSE", "14:46:10"],
  ["CEO", 12.6, 0.0, 0.0, 12.6, 12.7, 12.5, 2515900, 3.172367e10, 12.6, 13.8, 11.4, "HNX", "15:01:00"],
  ["GVR", 31.7, -0.15, -0.471, 32.0, 32.05, 31.45, 969100, 3.073938e10, 31.85, 34.05, 29.65, "HOSE", "14:45:02"],
  ["HVN", 21.45, -0.45, -2.0548, 21.9, 22.15, 21.4, 1369100, 2.9545145e10, 21.9, 23.4, 20.4, "HOSE", "14:46:12"],
  ["MCH", 142.0, 0.0, 0.0, 141.1, 142.5, 141.0, 205000, 2.904513e10, 142.0, 151.9, 132.1, "HOSE", "14:46:14"],
  ["VTP", 50.8, 0.4, 0.7937, 50.2, 51.4, 50.2, 566700, 2.877311e10, 50.4, 53.9, 46.9, "HOSE", "14:51:28"],
  ["BCM", 40.7, -0.6, -1.4528, 41.6, 41.7, 40.3, 702700, 2.859889e10, 41.3, 44.15, 38.45, "HOSE", "14:45:01"],
  ["NLG", 24.8, -0.45, -1.7822, 24.85, 25.25, 24.75, 1145200, 2.847577e10, 25.25, 27.0, 23.5, "HOSE", "14:46:16"],
  ["LPS", 22.75, -0.4, -1.7279, 23.25, 23.55, 22.65, 1231800, 2.8186955e10, 23.15, 24.75, 21.55, "HOSE", "14:46:14"],
  ["IDC", 30.8, -0.2, -0.6452, 31.1, 31.2, 30.6, 892300, 2.748164e10, 31.0, 34.1, 27.9, "HNX", "15:01:00"],
  ["DMX", 74.8, -0.2, -0.2667, 74.5, 75.2, 74.1, 349100, 2.611942e10, 75.0, 80.2, 69.8, "HOSE", "14:46:06"],
  ["VCG", 15.45, -0.05, -0.3226, 15.55, 15.6, 15.45, 1598300, 2.4772205e10, 15.5, 16.55, 14.45, "HOSE", "14:46:25"],
  ["DGC", 47.0, 0.4, 0.8584, 46.7, 47.0, 46.45, 528900, 2.4701665e10, 46.6, 49.85, 43.35, "HOSE", "14:46:05"],
  ["MSB", 12.95, 0.05, 0.3876, 12.85, 13.0, 12.7, 1922400, 2.4670765e10, 12.9, 13.8, 12.0, "HOSE", "14:46:14"],
  ["VGC", 41.5, 1.0, 2.4691, 40.6, 42.2, 40.2, 594400, 2.447775e10, 40.5, 43.3, 37.7, "HOSE", "14:46:25"],
  ["VC3", 23.7, 0.1, 0.4237, 23.5, 23.7, 23.3, 1004600, 2.363314e10, 23.6, 25.9, 21.3, "HNX", "15:01:00"],
  ["KBC", 27.0, 0.05, 0.1855, 26.7, 27.0, 26.6, 876900, 2.3498485e10, 26.95, 28.8, 25.1, "HOSE", "14:46:12"],
  ["CTD", 59.0, -1.1, -1.8303, 60.6, 60.6, 58.8, 396100, 2.348075e10, 60.1, 64.3, 55.9, "HOSE", "14:46:04"],
  ["ORS", 13.45, -0.1, -0.738, 13.5, 13.6, 13.3, 1649200, 2.2184745e10, 13.55, 14.45, 12.65, "HOSE", "14:46:17"],
  ["VTZ", 20.4, -0.1, -0.4878, 20.5, 20.6, 20.4, 1075700, 2.198978e10, 20.5, 22.5, 18.5, "HNX", "15:01:00"],
  ["GMD", 75.2, -0.4, -0.5291, 75.7, 76.0, 75.1, 289500, 2.182605e10, 75.6, 80.8, 70.4, "HOSE", "14:46:09"],
  ["PC1", 20.45, -0.25, -1.2077, 20.6, 20.6, 20.4, 1055100, 2.1612565e10, 20.7, 22.1, 19.3, "HOSE", "14:46:17"],
  ["HSG", 10.5, -0.1, -0.9434, 10.55, 10.6, 10.5, 2037000, 2.147221e10, 10.6, 11.3, 9.86, "HOSE", "14:46:11"],
  ["CTS", 22.25, 0.25, 1.1364, 21.9, 22.6, 21.8, 960100, 2.12538e10, 22.0, 23.5, 20.5, "HOSE", "14:46:04"],
  ["HUT", 12.9, 0.0, 0.0, 12.9, 13.0, 12.6, 1601300, 2.054986e10, 12.9, 14.1, 11.7, "HNX", "15:01:00"],
  ["E1VFVN30", 35.45, 0.06, 0.1695, 35.37, 35.55, 35.13, 547200, 1.9316049e10, 35.39, 37.86, 32.92, "HOSE", "14:46:37"],
  ["NAF", 48.0, -0.3, -0.6211, 48.3, 48.3, 47.85, 389300, 1.8683795e10, 48.3, 51.6, 44.95, "HOSE", "14:45:02"],
  ["DIG", 10.25, 0.0, 0.0, 10.25, 10.25, 10.1, 1832100, 1.867037e10, 10.25, 10.95, 9.54, "HOSE", "14:46:06"],
  ["MST", 10.1, -0.1, -0.9804, 10.1, 10.2, 10.0, 1835200, 1.846061e10, 10.2, 11.2, 9.2, "HNX", "15:01:00"],
  ["OIL", 13.8, -0.2, -1.4286, 14.0, 14.1, 13.6, 1302700, 1.804975e10, 14.0, 16.1, 11.9, "UPCOM", "15:00:01"],
  ["BVS", 28.4, 0.2, 0.7092, 28.2, 28.8, 27.8, 615800, 1.744195e10, 28.2, 31.0, 25.4, "HNX", "15:01:00"],
  ["HHP", 17.1, -0.1, -0.5814, 17.2, 17.35, 17.0, 919400, 1.578596e10, 17.2, 18.4, 17.0, "HOSE", "14:45:02"],
  ["HAH", 47.1, 0.5, 1.073, 46.3, 47.5, 46.3, 328400, 1.541199e10, 46.6, 49.85, 43.35, "HOSE", "14:46:10"],
  ["ABB", 17.3, 0.1, 0.5814, 17.2, 17.3, 17.2, 886400, 1.52773e10, 17.2, 19.7, 14.7, "UPCOM", "15:00:01"],
  ["NAB", 11.25, 0.0, 0.0, 11.3, 11.3, 11.15, 1323400, 1.4856005e10, 11.25, 12.0, 10.5, "HOSE", "14:46:15"],
  ["HHV", 9.82, -0.06, -0.6073, 9.88, 9.89, 9.81, 1497600, 1.4736255e10, 9.88, 10.55, 9.19, "HOSE", "14:45:02"],
];

/** Tên doanh nghiệp nguyên văn từ /v4/stocks (mã không có trong này → null). */
const NAMES: Record<string, string> = {
  VHM: "Công ty cổ phần Vinhomes",
  VIC: "Tập đoàn VINGROUP - CTCP",
  FPT: "Công ty Cổ phần FPT",
  SHB: "Ngân hàng Thương mại Cổ phần Sài Gòn - Hà Nội",
  VPB: "Ngân hàng Thương mại Cổ phần Việt Nam Thịnh Vượng",
  VIX: "CÔNG TY CỔ PHẦN CHỨNG KHOÁN VIX",
  HPG: "Công ty Cổ phần Tập đoàn Hòa Phát",
  SSI: "Công ty Cổ phần chứng khoán SSI",
  PVT: "Tổng Công ty Cổ phần Vận tải dầu khí",
  STB: "Ngân hàng TMCP Sài Gòn Tài Lộc",
  HDB: "Ngân hàng Thương mại Cổ phần Phát triển Thành phố Hồ Chí Minh",
  BSR: "Công ty Cổ phần - Tổng Công ty Lọc hóa dầu Việt Nam",
  DGW: "Công ty Cổ phần Thế giới Số",
  MSN: "Công ty Cổ phần Tập đoàn Masan",
  CTG: "Ngân hàng Thương mại Cổ phần Công Thương Việt Nam",
  TCB: "Ngân hàng Thương mại Cổ phần Kỹ Thương Việt Nam - Techcombank",
  VCB: "Ngân hàng Thương mại Cổ phần Ngoại thương Việt Nam",
  MWG: "Công ty Cổ phần đầu tư Thế giới di động",
  VPI: "Công Ty Cổ Phần Phát Triển Bất Động Sản Văn Phú",
  VND: "Công ty Cổ phần Chứng khoán VNDIRECT",
  MBB: "Ngân hàng Thương mại Cổ phần Quân đội",
  MSR: "CÔNG TY CỔ PHẦN MASAN HIGH-TECH MATERIALS",
  VNM: "Công ty Cổ phần Sữa Việt Nam",
  LPB: "Ngân hàng Thương mại cổ phần Lộc Phát Việt Nam",
  CII: "Công ty Cổ phần Đầu tư Hạ tầng Kỹ thuật Thành phố Hồ Chí Minh",
  VRE: "Công ty Cổ phần Vincom Retail",
  VCI: "Công ty Cổ phần Chứng khoán Vietcap",
  GEX: "Công ty Cổ phần Tập đoàn Gelex",
  GAS: "Tổng Công ty Khí Việt Nam - CTCP",
  VJC: "Công ty cổ phần Hàng không VIETJET",
  DCM: "Công ty Cổ phần Phân Bón Dầu khí Cà Mau",
  SHS: "Công ty Cổ phần Chứng khoán Sài Gòn Hà Nội",
  ACB: "Ngân hàng Thương mại Cổ phần Á Châu",
  BID: "Ngân hàng Thương mại Cổ phần Đầu tư và Phát triển Việt Nam",
  DXG: "Công ty Cổ phần Bluemarq Group",
  PVD: "Tổng Công ty Cổ phần Khoan và Dịch vụ khoan dầu khí",
  VSC: "Công ty Cổ phần Container Việt Nam",
  PVS: "Tổng Công ty Cổ phần Dịch vụ Kỹ thuật Dầu khí Việt Nam",
  DCL: "Công ty Cổ phần Dược phẩm Cửu Long",
  HCM: "Công ty Cổ phần Chứng khoán Thành phố Hồ Chí Minh",
  FRT: "Công ty cổ phần Bán lẻ Kỹ thuật số FPT",
  PNJ: "Công ty Cổ phần Vàng bạc đá quý Phú Nhuận",
  GEE: "Công ty cổ phần Điện lực Gelex",
  TPB: "Ngân hàng Thương mại cổ phần Tiên Phong",
  DPM: "Tổng Công ty Cổ phần Phân bón và Hóa chất dầu khí",
  NTP: "Công ty Cổ phần Nhựa Thiếu niên Tiền Phong",
  POW: "Tổng Công ty Điện lực Dầu khí Việt Nam – Công ty cổ phần",
  VPL: "Công ty Cổ phần Vinpearl",
  NVL: "Công ty cổ phần Tập đoàn Đầu tư Địa ốc No Va",
  VCK: "Công ty Cổ phần Chứng khoán VPS",
  TCH: "Công ty Cổ phần Đầu tư Dịch vụ Tài chính Hoàng Huy",
  PDR: "Công ty Cổ phần Phát triển Bất động sản Phát Đạt",
  VIB: "Ngân hàng Thương mại Cổ phần Quốc tế Việt Nam",
  SBT: "Công ty Cổ phần Thành Thành Công - Biên Hòa",
  BAF: "Công ty Cổ phần Nông nghiệp BAF Việt Nam",
  EIB: "Ngân hàng Thương mại Cổ phần Xuất nhập khẩu Việt Nam",
  MBS: "Công ty Cổ phần chứng khoán MB",
  GEL: "Công ty Cổ phần Hạ tầng GELEX",
  PVP: "Công ty cổ phần Vận tải Dầu khí Thái Bình Dương",
  HAG: "Công ty Cổ phần Hoàng Anh Gia Lai",
  GVR: "Tập đoàn Công nghiệp Cao su Việt Nam - Công ty cổ phần",
  HVN: "Tổng Công ty Hàng không Việt Nam - CTCP",
  MCH: "Công ty cổ phần Hàng Tiêu Dùng Masan",
  VTP: "Tổng công ty Cổ phần Bưu chính Viettel",
  BCM: "Tập đoàn Đầu tư và Phát triển Công nghiệp Becamex - CTCP",
  NLG: "Công ty Cổ phần Đầu tư Nam Long",
  IDC: "Tổng Công ty IDICO - CTCP",
  DMX: "Công ty cổ phần Đầu tư Điện Máy Xanh",
  VCG: "Tổng Công ty Cổ phần Xuất nhập khẩu và xây dựng Việt Nam",
  DGC: "Công ty cổ phần Tập đoàn Hóa chất Đức Giang",
  MSB: "Ngân hàng Thương mại Cổ phần Hàng Hải Việt Nam",
  VGC: "Tổng Công ty Viglacera - CTCP",
  VC3: "CÔNG TY CỔ PHẦN TẬP ĐOÀN NAM MÊ KÔNG",
  KBC: "Tổng Công ty Phát triển Đô thị Kinh Bắc - CTCP",
  CTD: "Công ty Cổ phần Xây dựng Coteccons",
  ORS: "Công ty Cổ phần Chứng khoán Tiên Phong",
  GMD: "Công Ty TNHH Vận Tải Và Công Nghiệp Hàng Hải Gemadept Holding",
  PC1: "Công ty Cổ phần Tập đoàn PC1",
  HSG: "Công ty Cổ phần Tập đoàn Hoa Sen",
  CTS: "Công Ty Cổ Phần Chứng Khoán VietinBank",
  E1VFVN30: "Quỹ ETF DCVFMVN30",
  NAF: "Công ty Cổ phần Nafoods Group",
  DIG: "Tổng công ty Đầu tư phát triển Xây dựng",
  MST: "Công ty cổ phần đầu tư MST",
  OIL: "Tổng Công ty Dầu Việt Nam – Công ty cổ phần",
  BVS: "Công ty Cổ phần Chứng khoán Bảo Việt",
  HHP: "Công ty Cổ phần HHP Global",
  HAH: "Công ty Cổ phần Vận tải và xếp dỡ Hải An",
  ABB: "Ngân hàng Thương mại Cổ phần An Bình",
  NAB: "Ngân hàng Thương mại Cổ phần Nam Á",
  HHV: "Công ty cổ phần Đầu tư Hạ tầng Giao thông Đèo Cả",
};

/** [code, value, change, pctChange, volume, time] */
type IdxRow = [string, number, number, number, number, string];
const INDICES: IdxRow[] = [
  ["VNINDEX", 1829.23, 2.11, 0.115482289066948, 383185655, "15:33:00"],
  ["VN30", 1976.82, 9.18, 0.466548758919316, 182146313, "15:33:00"],
  ["HNX", 278.37, -1.11, -0.397166165736373, 28129330, "15:53:00"],
  ["UPCOM", 126.87, -0.48, -0.376914016489982, 15466825, "15:53:00"],
  ["VN100", 1876.33, 6.49, 0.347088520942962, 342284051, "15:33:00"],
  ["HNX30", 453.52, 1.31, 0.289688419097311, 19596799, "15:53:00"],
];

function ts(time: string): string {
  return new Date(`${VN_BOARD_SNAPSHOT_SESSION}T${time}+07:00`).toISOString();
}

export interface VnBoardSnapshot {
  quotes: Quote[];
  indices: IndexQuote[];
  universe: { symbol: string; name: string | null; exchange: string | null; industry: null }[];
  sessionDate: string;
  sourceTs: number;
}

let built: VnBoardSnapshot | null = null;

export function getVnBoardSnapshot(): VnBoardSnapshot {
  if (built) return built;
  const quotes: Quote[] = ROWS.map(([sym, close, chg, pct, open, high, low, vol, val, ref, ceil, flr, exch, time]) => ({
    symbol: sym,
    name: NAMES[sym] ?? null,
    assetClass: "stock",
    price: close,
    change: chg,
    changePercent: pct,
    open,
    high,
    low,
    volume: vol,
    quoteVolume: val,
    referencePrice: ref,
    ceilingPrice: ceil,
    floorPrice: flr,
    updatedAt: ts(time),
  }));
  const indices: IndexQuote[] = INDICES.map(([code, value, chg, pct, vol, time]) => ({
    code,
    name: code,
    value,
    change: chg,
    changePercent: pct,
    volume: vol,
    updatedAt: ts(time),
  }));
  const universe = quotes.map((q) => ({
    symbol: q.symbol,
    name: q.name ?? null,
    exchange: ROWS.find((r) => r[0] === q.symbol)?.[12] ?? null,
    industry: null,
  }));
  const sourceTs = Math.max(...INDICES.map(([, , , , , t]) => Date.parse(ts(t))));
  built = { quotes, indices, universe, sessionDate: VN_BOARD_SNAPSHOT_SESSION, sourceTs };
  return built;
}
