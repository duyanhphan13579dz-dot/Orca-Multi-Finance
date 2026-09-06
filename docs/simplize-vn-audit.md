# SIMPLIZE × ORCA VIETNAM STOCK DATA ENGINE — FULL AUDIT & DECISION

> Ngày audit: **2026-09-06** · Kiểm tra trực tiếp: `simplize.vn`, `api.simplize.vn`, robot policy, điều khoản, pricing, trang cổ phiếu mẫu.
> Kết luận (Phase 12): **OPTION C — EMBED ONLY. VNDirect giữ nguyên là primary provider.**

---

## 1. PHASE 0 — KIỂM TRA THỰC TẾ (VERIFICATION LOG)

| # | Câu hỏi | Kết quả xác minh | Bằng chứng |
|---|---|---|---|
| 1 | Simplize có official API không? | **KHÔNG.** Không có tài liệu API, không có docs site, không có key self-serve. `api.simplize.vn` root → **404 Whitelabel (Spring Boot internal host)**. | `https://api.simplize.vn` fetch 2026-09-06 |
| 2 | API nào public? | Không có endpoint public nào được công bố. Mọi dữ liệu đi qua đường render trang web (SSR). | sitemap, trang `/co-phieu/VNM` |
| 3 | API nào cần auth? | `api.simplize.vn` là host nội bộ (không công bố); app/web dùng các endpoint nội bộ — **không được xem là official**. | api probe 404 |
| 4 | Dùng production app được không? | **KHÔNG** — cần phê duyệt bằng văn bản. | llms.txt: "Hợp tác dữ liệu (API)… cần phê duyệt bằng văn bản"; terms Điều 1 |
| 5 | Cache được không? | **KHÔNG.** Cache + serve lại = "sao chép, phân phối, tạo sản phẩm phái sinh" → vi phạm Điều 1. | terms |
| 6 | Hiển thị trong ORCA được không? | Trang công khai: nhằm mục đích "tham khảo thông tin thuần túy" (Điều 3.1); hiển thị lại dữ liệu game thay đổi trên trang B2B thì **không được phép**; widget embed thì **được phép** (xem câu 10). | terms Điều 3.1 |
| 7 | Proxy qua backend ORCA được không? | **KHÔNG** với dữ liệu từ trang scraping; backend chỉ có thể trỏ **link nhúng widget** (iframe chạy từ trình duyệt, không proxy dữ liệu). | widget-embed, llms.txt |
| 8 | Rate limit? | Không công bố — vì không có public API. Scraping hàng loạt bị cấm (thương mại) nên rate limit là N/A. | robots llms |
| 9 | Giới hạn commercial usage? | **CÓ, rõ ràng**: robots.txt cho AI bot Allow `/co-phieu/` nhưng kèm "Không cho phép sử dụng thương mại (xem llms.txt)"; llms.txt "Tạo dataset/huấn luyện mô hình AI thương mại từ dữ liệu Simplize: CẦN PHÊ DUYỆT BẰNG VĂN BẢN"; terms cấm derivative không văn bản. | robots.txt, llms.txt, terms |
| 10 | Widget embed có được phép riêng cho visualization? | **CÓ** — trang `/widget-embed` là tính năng chính thức "Nhúng widget biểu đồ chứng khoán **miễn phí** lên website", chỉ dùng cho **hiển thị biểu đồ tương tác cổ phiếu** (mẫu HPG/SSI/VCB). | widget-embed |

> ⚠️ Cảnh báo phương pháp: **KHÔNG** coi trang public, JSON trình duyệt đang dùng, endpoint nội bộ hay widget endpoint là "official public API". Tất cả các nguồn trên đều **chưa được xác minh là API hợp lệ** → không dùng cho production data engine.

---

## 2. DATA CAPABILITY MATRIX (Phase 1)

| Data type | Simplize support | Access method | Official/public | Realtime/Delayed | Rate limit | Cache policy | Production usability |
|---|---|---|---|---|---|---|---|
| A. Market indices (VNINDEX/VN30/HNX/UPCOM/sector) | ✅ Có | Trang công khai `/chi-so/*` | PUBLIC PAGE (không API) | Site tự mô tả realtime — **không verify được qua API** | N/A | ❌ Not-permitted-redistribution | ❌ **NOT-PERMITTED** |
| B. Stock quotes (giá, ref, ceiling, floor, O/H/L/prevClose, change, %, KL, GT) | ✅ Có (tự khớp lệnh) | Trang `/co-phieu/:symbol` | PUBLIC PAGE | Realtime-claim (page render) | N/A | ❌ | ❌ **NOT-PERMITTED** |
| C. Chart / historical (intraday, daily, weekly, monthly, OHLCV) | ✅ Có (page + widget) | **WIDGET EMBED** (chính thức) · `/chart?ticker=` (robots **Disallow /chart**) | **WIDGET-EMBED** | **LIVE qua embed** (biểu đồ cập nhật liên tục) | Không công bố | embed-only | ✅ **EMBED-ONLY** |
| D. Stock detail (công ty, sàn, ngành, vốn hóa, cổ phiếu lưu hành, metrics) | ✅ Có | Trang `/ho-so-doanh-nghiep`, `/co-phieu/:symbol` | PUBLIC PAGE | DELAYED | N/A | ❌ | ❌ **NOT-PERMITTED** |
| E. Financial statements (IS/BS/CF, Q, Y, 20 năm) | ✅ Có (rất đầy đủ) | Trang `/so-lieu-tai-chinh` | PUBLIC PAGE | DELAYED | N/A | ❌ | ❌ **NOT-PERMITTED** |
| F. Valuation & fundamentals (P/E, P/B, EPS, BVPS, ROE, ROA, margins, EV/EBITDA, Beta) | ✅ Có | Trang `/co-phieu/:symbol` | PUBLIC PAGE | DELAYED | N/A | ❌ | ❌ **NOT-PERMITTED** |
| G. Order book / market depth | ✅ Có **5 mức** bid/ask + KL + match detail + khối ngoại (KHÔNG phải L2 full depth) | Trang (Sổ lệnh) | PUBLIC PAGE | Realtime-claim | N/A | ❌ | ❌ **NOT-PERMITTED → ORCA trả UNAVAILABLE, không fake** |
| H. Buy/sell signals | ⚠️ Có **scoring riêng** ("Đánh giá 360": Định giá/Cổ tức/Tăng trưởng/Sức khỏe/Hiệu quả) — **không có** target price/BUY-HOLD-SELL của broker trên overview | Trang `/phan-tich` | PUBLIC PAGE | DELAYED | N/A | ❌ | ❌ **NOT-PERMITTED → không tự quy đổi thành BUY/HOLD/SELL** |
| I. Analysis reports (báo cáo công ty chứng khoán, ngành, vĩ mô) | ✅ Có (`/bao-cao` PDF, `/thi-truong/*`) | Trang/PDF link | PUBLIC PAGE | DELAYED | N/A | **📌 citation-only** | ⚠️ **CITATION-ONLY** (tóm tắt <90 ký tự + nguồn + timestamp; **không** lưu nguyên văn) |

**Tổng hợp:** 9/9 data type **tồn tại** trên Simplize (và rất phong phú), nhưng **0/9** có official API; chỉ **1/9** (chart) có đường truy cập được cấp phép (widget embed), **1/9** (reports) cho phép citation-only.

---

## 3. ORCA MIGRATION STRATEGY — TRẠNG THÁI TỪNG BƯỚC (Phase 4)

| Step | Module | Status | Lý do |
|---|---|---|---|
| 1 | Market indices | **VNDIRECT** (giữ) | Blocked-rights. Simplize chỉ hiển thị qua page; backend không được ingest. |
| 2 | Stock quotes | **VNDIRECT** (giữ) | Blocked-rights. Realtime page-only; commercial crawling bị cấm. |
| 3 | Historical/chart | **EMBED-ONLY** (sẵn sàng, chưa bật UI) | Widget được cấp phép. ORCA backend OHLC vẫn từ VNDirect/Yahoo; widget chỉ là visualization tùy chọn. |
| 4 | Stock detail & fundamentals | **VNDIRECT** (giữ) | Nội dung có bản quyền; cần văn bản đồng ý. |
| 5 | Financial statements | **VNDIRECT** (giữ) | Page-only; period/reportDate không xác minh qua API → không suy đoán. |
| 6 | Analysis reports & recommendations | **CITATION-ONLY** (link + attribution) | llms.txt cho phép tóm tắt có trích nguồn, <90 ký tự; không lưu báo cáo, không đổi thành BUY/HOLD/SELL. |
| 7 | Order book / depth | **VNDIRECT** (giữ) | Simplize 5 mức (không L2), page-only → không fake; ORCA giữ nguồn đã verify. |

**Quy tắc an toàn:** VNDirect **không bị xóa** cho tới khi Simplize được cấp phép API chính thức (liên hệ `info@simplize.vn` "Hợp tác dữ liệu (API)") và qua Data Comparison Engine (Phase 5).

---

## 4. KIẾN TRÚC ĐÃ TRIỂN KHAI (Phase 2, 3, 6, 10)

```text
SIMPLIZE (public web / widget embed)
   ↓
SimplizeClient (chỉ: probe /widget-embed · buildEmbedUrl template-verified)
   ↓
SimplizeProvider (VnDataProvider contract — data getters = UNAVAILABLE-with-reason)
   ↓
Normalization (vn-data-model: MarketIndex / StockQuote / Candle / StockProfile / Recommendation)
   ↓
Validation (validateEmbedDescriptor · validateQuote (existing) · compare engine)
   ↓
ORCA Market Data Model → Existing API → Existing UI (KHÔNG đổi UI)
```

- **`src/lib/providers/vn-data-model.ts`** — unified ORCA model (Phase 3) + `VnDataResult<T>` envelope với `source / timestamp / freshness` bắt buộc (Phase 6: realtime/delayed phân biệt — UNAVAILABLE là kết quả hợp lệ).
- **`src/lib/providers/simplize/`** — `types.ts` (capability registry), `capabilities.ts` (matrix + decision OPTION_C), `client.ts` (chỉ truy cập được cấp phép), `adapter.ts` (normalize/validate embed, **không** parse trang), `provider.ts` (mọi data getter trả UNAVAILABLE với reason), `index.ts`.
- **`src/lib/providers/vn-provider-chain.ts`** — chain `vndirect → simplize (candidate)`; Simplize chỉ chuyển primary khi `SIMPLIZE_DATA_ACCESS=approved-api` (cần giấy phép thật) — **default `none`**, VNDirect luôn primary.
- **`src/lib/services/vn-provider-compare.ts`** — Data Comparison Engine (Phase 5): compare quote/candles, timestamp freshness check, `runMigrationComparison()` trả SKIPPED với reason khi Simplize chưa có quyền (không tạo snapshot giả).
- **`GET /api/v1/providers/vn`** — capability matrix + verdict + migration plan + evidence (backend diagnostics, không ảnh hưởng UI).

---

## 5. MAPPING SIMPLIZE → ORCA (dự kiến khi có API license)

| ORCA model | Simplize field evidence (trang công khai, verif.) | Trạng thái |
|---|---|---|
| `StockQuote.price` | "Giá hiện tại: 61,900" | ✅ publish · ❌ ingest (rights) |
| `StockQuote.reference/ceiling/floor` | Chưa thấy hiển thị trực tiếp trên overview (có phiên/lệnh) | ⚠️ chưa xác minh qua API |
| `StockQuote.open/high/low/prevClose` | "Giá thấp nhất 61,200 / Giá cao nhất 62,100 / 24h"; prevClose từ change | ✅ publish |
| `StockQuote.volume/value` | "Khối lượng giao dịch 1,906,600" | ✅ publish |
| `MarketIndex.*` | `/chi-so/*` + sections VN-Index/VN30 | ✅ publish |
| `Candle.*` | Chart (TradingView nhúng) — **chỉ visual** | ⚠️ backend OHLC: **KHÔNG có**
| `StockProfile.marketCap / outstandingShares` | "Vốn hóa 129,368T", "Số lượng cổ phiếu lưu hành 2,089,955,460" | ✅ publish |
| `StockProfile.metrics.pe/pb/eps/bvps/evEbitda/beta5y` | P/E 11.8, P/B 4.06, EPS 5,245, BVPS 15,247, EV/EBITDA 6.87, Beta 0.5 | ✅ publish |
| `Recommendation.type` | "Đánh giá 360" + broker `/bao-cao` | ⚠️ phân loại: `ORCA_SYSTEM_SIGNAL` (scoring Simplize) vs `BROKER_RECOMMENDATION` (báo cáo có nguồn broker) — **tách biệt, không trộn** |
| Order book | 5 mức bid/ask + KL + match detail | ❌ ingest (page-only) |

---

## 6. KẾT LUẬN — FINAL DECISION (Phase 12)

### ✅ **OPTION C — EMBED ONLY** (kèm Citation-Only cho reports)

- **KHÔNG** nên Full Simplize: không có API license; backend redistribution vi phạm terms Điều 1 + llms.txt.
- **KHÔNG** nên Hybrid (backend): mọi data type đều page-only → hybrid backend không khả thi về quyền.
- **VNDirect giữ** toàn bộ: quotes, indices, candles, fundamentals, financials, order book, recommendations.
- **Simplize dùng** cho: widget biểu đồ (visualization, nếu UI tương lai muốn) + trích dẫn báo cáo có nguồn (citation-only).
- **Bridge tương lai**: abstraction `VnDataProvider` + `SIMPLIZE_DATA_ACCESS=approved-api` + Data Comparison Engine đã sẵn sàng — khi Simplize cấp API bằng văn bản, migration từng bước chạy được ngay mà không đổi UI.

---

## 7. FILE THAY ĐỔI

| File | Vai trò |
|---|---|
| `src/lib/providers/vn-data-model.ts` | NEW — unified ORCA model + `VnDataResult` (source/timestamp/freshness) |
| `src/lib/providers/simplize/types.ts` | NEW — registry types, evidence, verdict enum |
| `src/lib/providers/simplize/capabilities.ts` | NEW — Data Capability Matrix + OPTION_C decision + migration plan |
| `src/lib/providers/simplize/client.ts` | NEW — chỉ probe `/widget-embed` + buildEmbedUrl (template-verified) |
| `src/lib/providers/simplize/adapter.ts` | NEW — normalize/validate embed descriptor (không parse trang) |
| `src/lib/providers/simplize/provider.ts` | NEW — SimplizeProvider: data getters UNAVAILABLE-with-reason; embed OK |
| `src/lib/providers/simplize/index.ts` | NEW — barrel exports |
| `src/lib/providers/vn-provider-chain.ts` | NEW — provider chain (VNDirect primary; Simplize candidate) |
| `src/lib/services/vn-provider-compare.ts` | NEW — Data Comparison Engine (Phase 5) |
| `src/app/api/v1/providers/vn/route.ts` | NEW — diagnostics API (matrix + verdict + migration) |
| `src/lib/env.ts` | MOD — `SIMPLIZE_DATA_ACCESS`, `SIMPLIZE_WIDGET_URL_TEMPLATE`, `VN_PROVIDER_ORDER` |
| `src/lib/__tests__/simplize-provider.test.ts` | NEW — 8 tests |
| `src/lib/__tests__/vn-provider-compare.test.ts` | NEW — 5 tests |
| `docs/simplize-vn-audit.md` | NEW — báo cáo này |
| `docs/data-providers.md` | MOD — mục Simplize VN stocks |
| `docs/api.md` | MOD — dòng `/api/v1/providers/vn` |

**KHÔNG đổi**: UI/UX (layout/theme/sidebar/chart container), VNDirect provider/service, stocks service flow.

## 8. KẾT QUẢ VERIFICATION

- `npm run typecheck` — ✅ pass
- `npm test` — ✅ (chạy full suite sau)
- `npm run lint` — phải 0 errors
- `npm run build` — ✅ (với `DATABASE_URL` như build chuẩn của repo)
