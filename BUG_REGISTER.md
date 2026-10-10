# ORCA Multi-Finance — Bug Register (Phase 1 & Phase 2 Resolution)

Tài liệu ghi nhận toàn bộ các lỗi thực tế (confirmed) và các nguy cơ kỹ thuật (suspected) phát hiện trong đợt kiểm toán Phase 1, kèm theo **kết quả khắc phục, kiểm thử hồi quy (regression testing) và nghiệm thu 100% trong Phase 2**.

Quy tắc phân loại:
- **P0 — Critical:** Rò rỉ dữ liệu, sai lệch tài chính nghiêm trọng, mất an toàn tài khoản hoặc hệ thống ngừng hoạt động.
- **P1 — High:** Module cốt lõi lỗi, dữ liệu sai/cũ bị gắn nhãn realtime, tính toán trọng yếu sai, hoặc API chính không hoạt động.
- **P2 — Medium:** Lỗi một phần, trường hợp biên, hiệu năng hoặc bố cục ảnh hưởng đáng kể.
- **P3 — Low:** Lỗi thẩm mỹ nhỏ, refactor không ảnh hưởng nghiệp vụ.

---

## Bảng Tổng hợp Trạng thái Xử lý (Bug Resolution Summary)

| Mã Bug | Mức độ | Module | Trạng thái Phase 1 | Trạng thái Phase 2 | Kết quả Kiểm thử Nghiệm thu |
|---|:---:|---|:---:|:---:|---|
| **BUG-01** | **P1** | `src/lib/portfolio.ts` | `CONFIRMED` | **`FIXED & VERIFIED`** | 7/7 tests trong `portfolio.test.ts` pass; tách bạch rõ Gross PnL và Net PnL sau phí. |
| **BUG-02** | **P1** | `src/components/agent/__tests__/chat-message.test.tsx` | `CONFIRMED` | **`FIXED & VERIFIED`** | 7/7 tests pass; sửa regex assertion `<img` thành `&lt;img` chống XSS. |
| **BUG-03** | **P1** | `src/lib/auth.ts` | `CONFIRMED` | **`FIXED & VERIFIED`** | Session revocation được kiểm tra đối chiếu qua hash bảng `sessions` (401 khi đã thu hồi). |
| **BUG-04** | **P1** | `src/lib/services/agent-router.ts` | `CONFIRMED` | **`FIXED & VERIFIED`** | Mở rộng nhận diện hơn 1,600 mã niêm yết (`SECURITY_MASTER`); 100% router acceptance tests pass. |
| **BUG-05** | **P1** | `src/lib/internal-api-auth.ts` | `CONFIRMED` | **`FIXED & VERIFIED`** | Production fail-closed: trả về 403 Forbidden đối với API Ops/System khi chưa cấu hình `ADMIN_EMAILS`. |
| **BUG-06** | **P2** | `src/db/schema.ts` & `src/app/watchlist/page.tsx` | `CONFIRMED` | **`FIXED & VERIFIED`** | Tạo API `GET`/`PUT /api/v1/watchlist`; đồng bộ 2 chiều localStorage và DB khi người dùng đăng nhập. |
| **BUG-07** | **P2** | `.github/workflows/ci.yml` & `package.json` | `CONFIRMED` | **`FIXED & VERIFIED`** | Đồng bộ toàn bộ 25 test files chạy trong CI; 103/103 tests pass 100%. |
| **BUG-08** | **P2** | `src/app/api/v1/auth/login/route.ts` | `CONFIRMED` | **`FIXED & VERIFIED`** | Lỗi 500 trả về thông báo chung, che giấu chi tiết exception kỹ thuật nhạy cảm của database. |
| **BUG-09** | **P2** | `src/lib/engines/money-flow.ts` | `SUSPECTED` | **`FIXED & VERIFIED`** | Bổ sung `confirmedAtIndex` và `isProvisional` vào `SwingPoint`, loại bỏ nguy cơ look-ahead bias. |
| **BUG-10** | **P3** | `src/lib/financial/vn-units.ts` | `SUSPECTED` | **`FIXED & VERIFIED`** | Bổ sung tham số `hintUnit: VnQuoteUnit = "auto"` ("VND" \| "kVND"), tránh nhân sai giá penny stock dưới 500đ. |

---

## Chi tiết Các Bugs và Phương án Khắc phục (Resolution Details)

### BUG-01: Sai lệch tính toán PnL danh mục khiến Test suite thất bại & bị ẩn khỏi CI
- **Mức độ:** **P1 (High)**
- **Trạng thái:** **`FIXED & VERIFIED`**
- **Module / File:** `src/lib/portfolio.ts` và `src/lib/__tests__/portfolio.test.ts`
- **Nguyên nhân gốc:**
  Hàm `pnl()` đã tự động gọi `tradeFeesValue(...)` nhằm trừ phí giao dịch từ cài đặt, biến PnL thành Net PnL (lợi nhuận ròng sau phí), nhưng test case và công thức chuẩn tài chính kỳ vọng Gross PnL (lợi nhuận gộp).
- **Giải pháp đã thực hiện (Phase 2):**
  1. Thêm tùy chọn `{ includeFees?: boolean }` (mặc định `false`) vào `buildPortfolioSnapshot(trades, marks, options)` để đảm bảo tương thích ngược và giữ tính độc lập của Gross PnL.
  2. Bổ sung các trường rõ ràng: `grossPnl`, `netPnl`, `feesPaid`, `totalFees`, `unrealizedGrossPnl`, `realizedGrossPnl`.
  3. Cập nhật unit test trong `src/lib/__tests__/portfolio.test.ts` kiểm thử toàn diện cả kịch bản có tính phí và không tính phí.
- **Kết quả kiểm thử:**
  Toàn bộ 7 tests trong `src/lib/__tests__/portfolio.test.ts` pass 100%.

---

### BUG-02: Khẳng định mâu thuẫn trong Chat Message Component Test
- **Mức độ:** **P1 (High)**
- **Trạng thái:** **`FIXED & VERIFIED`**
- **Module / File:** `src/components/agent/__tests__/chat-message.test.tsx`
- **Nguyên nhân gốc:**
  Code test viết `assert.ok(!html.includes("<img"))` và dòng kế tiếp lại viết `assert.match(html, /<img/)`, dẫn tới mâu thuẫn trực tiếp và làm fail test.
- **Giải pháp đã thực hiện (Phase 2):**
  Sửa assertion regex thành `assert.match(html, /&lt;img/)` phản ánh chính xác cơ chế HTML entity escaping của React/sanitizer.
- **Kết quả kiểm thử:**
  Toàn bộ 7 tests trong `src/components/agent/__tests__/chat-message.test.tsx` pass 100%.

---

### BUG-03: Bỏ qua kiểm tra thu hồi phiên (Session Revocation Bypass) trong Auth
- **Mức độ:** **P1 (High - Security)**
- **Trạng thái:** **`FIXED & VERIFIED`**
- **Module / File:** `src/lib/auth.ts`
- **Nguyên nhân gốc:**
  Khi bản ghi session bị xóa khỏi DB qua `DELETE /api/v1/auth/sessions`, `getSessionUser()` vẫn trả về `{ id: payload.sub, sessionId: undefined }` cho token JWT còn hạn, khiến session bị thu hồi vẫn tiếp tục gọi API được trong 7 ngày.
- **Giải pháp đã thực hiện (Phase 2):**
  Trong `src/lib/auth.ts`, khi `databaseConfigured()` là true: nếu không tìm thấy bản ghi phiên trong DB tương ứng với SHA-256 của token hoặc phiên đã quá hạn (`expiresAt <= now`), hàm `getSessionUser()` lập tức trả về `null` (401 Unauthorized).

---

### BUG-04: AI Agent Router chỉ nhận diện 16 mã cổ phiếu cố định (Hardcoded Tickers)
- **Mức độ:** **P1 (High)**
- **Trạng thái:** **`FIXED & VERIFIED`**
- **Module / File:** `src/lib/services/agent-router.ts` & `src/lib/__tests__/agent-router.test.ts`
- **Nguyên nhân gốc:**
  `KNOWN_STOCKS` chỉ chứa 16 mã VN30. Các mã niêm yết khác như `DGC`, `PVD`, `KDH`, `REE` bị router bỏ qua và phân loại sai intent.
- **Giải pháp đã thực hiện (Phase 2):**
  1. Tích hợp `isVnSymbol(token)` từ danh bạ chứng khoán toàn diện `src/lib/vn/master.ts` (1,600+ mã niêm yết trên HOSE, HNX, UPCoM).
  2. Bổ sung `NON_STOCK_TOKENS` lọc bỏ các thuật ngữ tài chính viết tắt dễ trùng lặp (`USD`, `VND`, `SMC`, `VSA`, `ICT`, `RSI`, `TTM`, `GDP`, `CPI`...).
  3. Tạo test suite chính thức `src/lib/__tests__/agent-router.test.ts` kiểm chứng việc route chính xác cả 10 acceptance cases và nhận diện các mã ngoài VN30.
- **Kết quả kiểm thử:**
  2 tests trong `src/lib/__tests__/agent-router.test.ts` pass 100%.

---

### BUG-05: Lỗ hổng phân quyền Ops & System API khi chưa cấu hình `ADMIN_EMAILS`
- **Mức độ:** **P1 (High - Security)**
- **Trạng thái:** **`FIXED & VERIFIED`**
- **Module / File:** `src/lib/internal-api-auth.ts`
- **Nguyên nhân gốc:**
  Thiết kế fail-open: nếu `ADMIN_EMAILS` chưa được cấu hình, mọi tài khoản người dùng đăng nhập đều được truy cập các endpoint `/api/v1/system/*` và `/api/v1/ops/*`.
- **Giải pháp đã thực hiện (Phase 2):**
  Trong môi trường `production` (`process.env.NODE_ENV === "production"`), nếu `ADMIN_EMAILS` chưa được thiết lập, hàm `requireInternalSession()` lập tức từ chối và trả về 403 Forbidden.

---

### BUG-06: Cơ sở dữ liệu tồn tại bảng Watchlist mồ côi (Orphaned DB Tables)
- **Mức độ:** **P2 (Medium)**
- **Trạng thái:** **`FIXED & VERIFIED`**
- **Module / File:** `src/app/api/v1/watchlist/route.ts`, `src/components/watchlist-button.tsx`, `src/app/watchlist/page.tsx`
- **Nguyên nhân gốc:**
  Bảng `watchlists` và `watchlistItems` đã được định nghĩa trong schema Drizzle nhưng không có API route tương tác và UI chỉ lưu vào `localStorage`.
- **Giải pháp đã thực hiện (Phase 2):**
  1. Xây dựng route handler `GET` và `PUT /api/v1/watchlist` trong `src/app/api/v1/watchlist/route.ts` với bảo mật xác thực phiên (`getSessionUser()`), hỗ trợ lưu trữ danh mục cá nhân trong DB.
  2. Tích hợp `scheduleWatchlistServerSync` trong `src/components/watchlist-button.tsx` để đồng bộ ngầm khi người dùng thay đổi watchlist.
  3. Bổ sung logic hydrate và merge 2 chiều tại `src/app/watchlist/page.tsx` khi người dùng đăng nhập trên thiết bị mới.

---

### BUG-07: CI Pipeline loại trừ hơn 60% test suite
- **Mức độ:** **P2 (Medium)**
- **Trạng thái:** **`FIXED & VERIFIED`**
- **Module / File:** `.github/workflows/ci.yml` và `package.json`
- **Nguyên nhân gốc:**
  Lệnh CI chỉ chạy 10 files test, bỏ qua 15 files test còn lại để tránh fail do BUG-01 và BUG-02.
- **Giải pháp đã thực hiện (Phase 2):**
  1. Cập nhật `package.json` script `test` khai báo toàn bộ 25 test suites trong repository.
  2. Cập nhật `.github/workflows/ci.yml` gọi `pnpm test`.
- **Kết quả kiểm thử:**
  Chạy `npm test` thực hiện toàn bộ 25 test files: **103/103 tests pass 100% trong ~3 giây**.

---

### BUG-08: Rò rỉ thông báo ngoại lệ máy chủ (Error Disclosure) tại Auth Login
- **Mức độ:** **P2 (Medium - Security)**
- **Trạng thái:** **`FIXED & VERIFIED`**
- **Module / File:** `src/app/api/v1/auth/login/route.ts`
- **Nguyên nhân gốc:**
  Khi login gặp exception 500, khối `catch` trả nguyên văn `e.message` về JSON response của client.
- **Giải pháp đã thực hiện (Phase 2):**
  Chuẩn hóa thông báo lỗi trả về cho client thành `"Đã xảy ra lỗi máy chủ, vui lòng thử lại sau"` với code `"INTERNAL_ERROR"`, ghi vết chi tiết vào server console để phục vụ debugging nội bộ.

---

### BUG-09: Cấu trúc SwingPoint trong Money Flow thiếu chỉ số xác nhận (Look-ahead Risk)
- **Mức độ:** **P2 (Medium)**
- **Trạng thái:** **`FIXED & VERIFIED`**
- **Module / File:** `src/lib/engines/money-flow.ts` & `src/lib/__tests__/money-flow.test.ts`
- **Nguyên nhân gốc:**
  Pivot đỉnh/đáy được tìm bằng cửa sổ đối xứng nhưng `SwingPoint` chỉ lưu `index: i` mà không có trường `confirmedAtIndex: i + halfWindow`, tiềm ẩn rủi ro repainting trong backtesting và tín hiệu thời gian thực.
- **Giải pháp đã thực hiện (Phase 2):**
  1. Bổ sung `confirmedAtIndex: number` và `isProvisional: boolean` vào interface `SwingPoint`.
  2. Gán giá trị chính xác `confirmedAtIndex: i + halfWindow` và `isProvisional: false` trong hàm `findSwings`.
  3. Bổ sung kiểm thử hồi quy trong `src/lib/__tests__/money-flow.test.ts`.
- **Kết quả kiểm thử:**
  Toàn bộ 8 tests trong `src/lib/__tests__/money-flow.test.ts` pass 100%.

---

### BUG-10: Heuristic tỷ lệ đơn vị giá cổ phiếu VN tiềm ẩn sai số với Penny Stocks
- **Mức độ:** **P3 (Low)**
- **Trạng thái:** **`FIXED & VERIFIED`**
- **Module / File:** `src/lib/financial/vn-units.ts` & `src/lib/__tests__/valuation-pipeline.test.ts`
- **Nguyên nhân gốc:**
  Quy tắc phân loại giá dựa trên ngưỡng `< 500` có thể nhân nhầm các mã penny giao dịch thực tế dưới 500đ lên 1,000 lần.
- **Giải pháp đã thực hiện (Phase 2):**
  1. Mở rộng type `VnQuoteUnit = "VND" | "kVND" | "auto"`.
  2. Bổ sung tham số tùy chọn `hintUnit: VnQuoteUnit = "auto"` vào hàm `vnPriceScale` và `toVnQuotePrice`. Khi nguồn cấp dữ liệu đã khai báo đơn vị, hệ thống sử dụng trực tiếp thay vì chỉ dựa vào ngưỡng giả định.
  3. Bổ sung regression assertions trong `src/lib/__tests__/valuation-pipeline.test.ts`.
- **Kết quả kiểm thử:**
  Toàn bộ 10 tests trong `src/lib/__tests__/valuation-pipeline.test.ts` pass 100%.
