import {
  SIMPLIZE_EVIDENCE,
  type AccessStatus,
  type RealtimeStatus,
  type SimplizeAuditDecision,
  type UsageStatus,
  type VnDataCapability,
  type VnDataType,
} from "./types";

/**
 * SIMPLIZE VN-STOCK CAPABILITY MATRIX (Phase 1) — verified 2026-09-06.
 *
 * Evidence-based rows only. Anything not verified is marked NO-ACCESS or
 * NOT-PERMITTED — a public webpage or a browser JSON endpoint is NEVER
 * treated as an official public API without written confirmation.
 *
 * Key verified facts:
 * - api.simplize.vn root → 404 (Spring Boot Whitelabel = internal host).
 * - llms.txt: "Hợp tác dữ liệu (API) … cần phê duyệt bằng văn bản",
 *   "Tạo dataset/huấn luyện mô hình AI thương mại từ dữ liệu Simplize:
 *    CẦN PHÊ DUYỆT BẰNG VĂN BẢN", sao chép nguyên văn báo cáo: KHÔNG ĐƯỢC PHÉP.
 * - terms Điều 1: không sao chép/phân phối/tạo sản phẩm phái sinh khi chưa có
 *   đồng ý bằng văn bản.
 * - robots.txt: /chart, /news/*, /screener/ bị Disallow (mọi bot);
 *   /co-phieu/ được Allow cho AI bots NHƯNG "không cho phép sử dụng thương mại".
 * - widget-embed: tính năng "Nhúng widget biểu đồ chứng khoán … miễn phí" —
 *   embed visualization được tường minh cấp phép.
 */

const NO = (orc: string, method: string, note: string, evidence: string[]): VnDataCapability => ({
  dataType: "stock-quotes",
  orcaModule: orc,
  simplizeSupport: true,
  accessMethod: method,
  officialStatus: "PUBLIC-PAGE",
  realtime: "REALTIME-PAGE-CLAIM",
  rateLimit: "N/A — không có API công khai; page render theo request trình duyệt",
  cachePolicy: "not-permitted-redistribution",
  productionUsable: "NOT-PERMITTED",
  evidence,
  note,
});

export const CAPABILITY_MATRIX: VnDataCapability[] = [
  {
    dataType: "market-indices",
    orcaModule: "vn-market-engine · market/index",
    simplizeSupport: true,
    accessMethod: "public page /chi-so/* (VN-Index, VN30, HNX-Index, UPCOM-Index, sector indices)",
    officialStatus: "PUBLIC-PAGE",
    realtime: "REALTIME-PAGE-CLAIM",
    rateLimit: "N/A — không có API công khai",
    cachePolicy: "not-permitted-redistribution",
    productionUsable: "NOT-PERMITTED",
    evidence: [SIMPLIZE_EVIDENCE.llms, SIMPLIZE_EVIDENCE.terms, SIMPLIZE_EVIDENCE.stockPage],
    note: "Site tự mô tả realtime nhưng chỉ qua page render; backend ingestion + cache + serve lại = redistribution → vi phạm terms Điều 1 / llms.txt. Không xác minh được cơ chế realtime qua API.",
  },
  {
    dataType: "stock-quotes",
    orcaModule: "vn-market-engine · stocks",
    simplizeSupport: true,
    accessMethod: "public page /co-phieu/:symbol (giá, ref/ceiling/floor, OHLC, KL, GT; tự khớp lệnh)",
    officialStatus: "PUBLIC-PAGE",
    realtime: "REALTIME-PAGE-CLAIM",
    rateLimit: "N/A — không có API công khai",
    cachePolicy: "not-permitted-redistribution",
    productionUsable: "NOT-PERMITTED",
    evidence: [SIMPLIZE_EVIDENCE.robots, SIMPLIZE_EVIDENCE.terms, SIMPLIZE_EVIDENCE.stockPage],
    note: "robots Allow /co-phieu/ cho AI crawlers NHƯNG kèm 'không cho phép sử dụng thương mại'; quote dữ liệu realtime chỉ hiển thị trong trang. Scraping hàng loạt → không được phép.",
  },
  {
    dataType: "chart-history",
    orcaModule: "chart engine · /chart/history",
    simplizeSupport: true,
    accessMethod: "WIDGET-EMBED (trang /widget-embed — tính năng miễn phí chính thức) · page /chart?ticker=:symbol (robots Disallow /chart)",
    officialStatus: "WIDGET-EMBED",
    realtime: "LIVE-VIA-EMBED",
    rateLimit: "Không công bố — embed dùng iframe từ trang Simplize (không có backend call)",
    cachePolicy: "embed-only",
    productionUsable: "EMBED-ONLY",
    evidence: [SIMPLIZE_EVIDENCE.widget, SIMPLIZE_EVIDENCE.robots],
    note: "Đây là phương thức DUY NHẤT được Simplize tường minh cấp phép cho website bên thứ ba: nhúng biểu đồ tương tác. Dùng iframe/snippet phía trình duyệt — backend ORCA không lấy được chuỗi OHLC để lưu/cache. /chart bị Disallow → không crawl. URL iframe chính xác đang hiển thị script-rendered trong trang generator — chưa xác minh literal src → provider dùng template cấu hình, không hard-code URL chưa xác minh.",
  },
  {
    dataType: "stock-detail",
    orcaModule: "stocks/[symbol] · profile",
    simplizeSupport: true,
    accessMethod: "public page /co-phieu/:symbol/ho-so-doanh-nghiep (thông tin công ty, ngành, công ty con)",
    officialStatus: "PUBLIC-PAGE",
    realtime: "DELAYED",
    rateLimit: "N/A — không có API công khai",
    cachePolicy: "not-permitted-redistribution",
    productionUsable: "NOT-PERMITTED",
    evidence: [SIMPLIZE_EVIDENCE.stockPage, SIMPLIZE_EVIDENCE.terms],
    note: "Nội dung mô tả công ty thuộc quyền tác giả Simplize; không sao chép vào backend cho production.",
  },
  {
    dataType: "financial-statements",
    orcaModule: "stocks/[symbol]/financials",
    simplizeSupport: true,
    accessMethod: "public page /co-phieu/:symbol/so-lieu-tai-chinh (20 năm, quarterly/annual — pricing)",
    officialStatus: "PUBLIC-PAGE",
    realtime: "DELAYED",
    rateLimit: "N/A — không có API công khai",
    cachePolicy: "not-permitted-redistribution",
    productionUsable: "NOT-PERMITTED",
    evidence: [SIMPLIZE_EVIDENCE.pricing, SIMPLIZE_EVIDENCE.terms],
    note: "Data rất đầy đủ nhưng chỉ trong giao diện trả phí/trang web; backend không được ghi/redistribute. Không 'suy đoán' period/reportDate khi không có nguồn hợp lệ — Phase 9.",
  },
  {
    dataType: "valuation-fundamentals",
    orcaModule: "valuation engine · stocks/[symbol]",
    simplizeSupport: true,
    accessMethod: "public page /co-phieu/:symbol (P/E, P/B, EPS, BVPS, EV/EBITDA, vốn hóa, cổ phiếu lưu hành, Beta 5Y)",
    officialStatus: "PUBLIC-PAGE",
    realtime: "DELAYED",
    rateLimit: "N/A — không có API công khai",
    cachePolicy: "not-permitted-redistribution",
    productionUsable: "NOT-PERMITTED",
    evidence: [SIMPLIZE_EVIDENCE.stockPage, SIMPLIZE_EVIDENCE.terms],
    note: "Số liệu hiển thị công khai nhưng là sản phẩm phân tích của Simplize; không ingest vào ORCA valuation engine khi chưa có giấy phép.",
  },
  {
    dataType: "order-book",
    orcaModule: "stocks/[symbol]/orderbook",
    simplizeSupport: true,
    accessMethod: "public page (Sổ lệnh: 5 mức bid/ask + KL đặt; chi tiết khớp lệnh; khối ngoại)",
    officialStatus: "PUBLIC-PAGE",
    realtime: "REALTIME-PAGE-CLAIM",
    rateLimit: "N/A — không có API công khai",
    cachePolicy: "not-permitted-redistribution",
    productionUsable: "NOT-PERMITTED",
    evidence: [SIMPLIZE_EVIDENCE.stockPage, SIMPLIZE_EVIDENCE.chartPage, SIMPLIZE_EVIDENCE.terms],
    note: "Cross-check: Simplize CÓ sổ lệnh (đúng 5 mức, không phải L2 full depth) nhưng chỉ trong trang. ORCA vẫn phải trả UNAVAILABLE — tuyệt đối không fake order book (Phase 7).",
  },
  {
    dataType: "buy-sell-signals",
    orcaModule: "stocks/[symbol]/recommendation + AI agent",
    simplizeSupport: true,
    accessMethod: "public page /phan-tich — 'Đánh giá 360' (Định giá/Cổ tức/Tăng trưởng/Sức khỏe tài chính/Hiệu quả) — scoring RIÊNG của Simplize",
    officialStatus: "PUBLIC-PAGE",
    realtime: "DELAYED",
    rateLimit: "N/A — không có API công khai",
    cachePolicy: "not-permitted-redistribution",
    productionUsable: "NOT-PERMITTED",
    evidence: [SIMPLIZE_EVIDENCE.stockPage, SIMPLIZE_EVIDENCE.llms],
    note: "Không thấy target price/khuyến nghị mua-bán của công ty chứng khoán trên overview; đây là hệ thống chấm điểm của Simplize, không phải BROKER RECOMMENDATION. Không tự quy đổi thành BUY/HOLD/SELL (Phase 8).",
  },
  {
    dataType: "analysis-reports",
    orcaModule: "reports · news intelligence",
    simplizeSupport: true,
    accessMethod: "public page /co-phieu/:symbol/bao-cao (báo cáo công ty chứng khoán, PDF, có ngày/nguồn) + /thi-truong/* bài viết",
    officialStatus: "PUBLIC-PAGE",
    realtime: "DELAYED",
    rateLimit: "N/A — không có API công khai",
    cachePolicy: "citation-only",
    productionUsable: "CITATION-ONLY",
    evidence: [SIMPLIZE_EVIDENCE.llms, SIMPLIZE_EVIDENCE.terms, SIMPLIZE_EVIDENCE.pricing],
    note: "llms.txt: tóm tắt có trích nguồn được phép; trích <90 ký tự được phép; sao chép nguyên văn báo cáo KHÔNG được phép. ORCA chỉ nên trỏ link + attribution + timestamp, không lưu nội dung báo cáo.",
  },
];

export function getCapability(dataType: VnDataType): VnDataCapability {
  const c = CAPABILITY_MATRIX.find((x) => x.dataType === dataType);
  if (!c) throw new Error(`capability not found: ${dataType}`);
  return c;
}

/** count matrix invariants — used by tests and the info API */
export function capabilityReport() {
  return {
    total: CAPABILITY_MATRIX.length,
    officialPublicApi: CAPABILITY_MATRIX.filter((c) => c.officialStatus === "OFFICIAL-PUBLIC-API").length,
    embedOnly: CAPABILITY_MATRIX.filter((c) => c.productionUsable === "EMBED-ONLY").map((c) => c.dataType),
    notPermitted: CAPABILITY_MATRIX.filter((c) => c.productionUsable === "NOT-PERMITTED").map((c) => c.dataType),
    citationOnly: CAPABILITY_MATRIX.filter((c) => c.productionUsable === "CITATION-ONLY").map((c) => c.dataType),
    unavailable: CAPABILITY_MATRIX.filter((c) => c.productionUsable === "UNAVAILABLE").map((c) => c.dataType),
  };
}

/* ------------------------------ FINAL DECISION ------------------------------ */

export const SIMPLIZE_DECISION: SimplizeAuditDecision = {
  verdict: "OPTION_C_EMBED_ONLY",
  summary:
    "Simplize KHÔNG có official public API (api.simplize.vn = 404 internal; llms.txt yêu cầu phê duyệt bằng văn bản cho dataset/API; terms cấm sao chép–phân phối; robots cho phép crawl /co-phieu/ nhưng cấm dùng thương mại). " +
    "→ ORCA GIỮ VNDirect làm provider dữ liệu; Simplize chỉ dùng ở mức WIDGET EMBED (biểu đồ tương tác, được cấp phép miễn phí) cho visualization nếu cần; " +
    "mọi data getter của SimplizeProvider trả UNAVAILABLE với reason đầy đủ — không mock, không scrape production.",
  partnershipContact: SIMPLIZE_EVIDENCE.contact,
  migration: [
    { step: 1, module: "MARKET INDICES", status: "VNDIRECT", reason: "Blocked by rights — page-only, no official API. Giữ VNDirect; Simplize có thể hiển thị qua embed sau khi có xác nhận." },
    { step: 2, module: "STOCK QUOTES", status: "VNDIRECT", reason: "Blocked by rights — realtime page-only; commercial crawling bị cấm (robots + terms)." },
    { step: 3, module: "HISTORICAL/CHART", status: "EMBED-ONLY", reason: "Widget embed được cấp phép miễn phí cho visualization. Backend OHLC vẫn từ VNDirect/Yahoo." },
    { step: 4, module: "STOCK DETAIL & FUNDAMENTALS", status: "VNDIRECT", reason: "Page-only nội dung có bản quyền — không ingest production khi chưa có văn bản đồng ý." },
    { step: 5, module: "FINANCIAL STATEMENTS", status: "VNDIRECT", reason: "Page-only; period/reportDate không xác minh được qua API → không suy đoán." },
    { step: 6, module: "ANALYSIS REPORTS & RECOMMENDATIONS", status: "CITATION-ONLY", reason: "Chỉ link + attribution (<90 ký tự, nguồn + timestamp theo llms.txt); không lưu báo cáo; không đổi thành BUY/HOLD/SELL." },
    { step: 7, module: "ORDER BOOK / DEPTH", status: "VNDIRECT", reason: "Simplize có 5 mức bid/ask (không L2) nhưng page-only → không fake; ORCA orderbook giữ nguồn VNDirect." },
  ],
};

export function decisionReport() {
  return {
    verdict: SIMPLIZE_DECISION.verdict,
    summary: SIMPLIZE_DECISION.summary,
    migration: SIMPLIZE_DECISION.migration,
  };
}
