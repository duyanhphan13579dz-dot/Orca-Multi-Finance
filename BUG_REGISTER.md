# ORCA Multi-Finance — Bug Register (Phase 1)

Tài liệu ghi nhận toàn bộ các lỗi thực tế (confirmed) và các nguy cơ kỹ thuật (suspected) phát hiện trong đợt kiểm toán Phase 1.  
Quy tắc phân loại:
- **P0 — Critical:** Rò rỉ dữ liệu, sai lệch tài chính nghiêm trọng, mất an toàn tài khoản hoặc hệ thống ngừng hoạt động.
- **P1 — High:** Module cốt lõi lỗi, dữ liệu sai/cũ bị gắn nhãn realtime, tính toán trọng yếu sai, hoặc API chính không hoạt động.
- **P2 — Medium:** Lỗi một phần, trường hợp biên, hiệu năng hoặc bố cục ảnh hưởng đáng kể.
- **P3 — Low:** Lỗi thẩm mỹ nhỏ, refactor không ảnh hưởng nghiệp vụ.

---

## Danh mục Bugs & Phát hiện

### BUG-01: Sai lệch tính toán PnL danh mục khiến Test suite thất bại & bị ẩn khỏi CI
- **Mức độ:** **P1 (High)**
- **Trạng thái:** `CONFIRMED`
- **Module / File:** `src/lib/portfolio.ts` (dòng 140–152) và `src/lib/__tests__/portfolio.test.ts`
- **Bằng chứng & Tái hiện:**
  ```bash
  node --import tsx --import ./test/test-setup/register-stub.mjs --require ./test/test-setup/patch-server-only.cjs --test src/lib/__tests__/portfolio.test.ts
  ```
  Kết quả: 3 tests thất bại (`19.58 !== 20`, `19.18 !== 20`, `204375 !== 250000`).
- **Nguyên nhân gốc (Root cause):**
  Trong `portfolio.ts`, hàm `pnl()` đã được sửa để gọi `tradeFeesValue(...)` nhằm trừ phí giao dịch từ cài đặt. Việc này biến PnL thành Net PnL (lợi nhuận ròng sau phí), nhưng test case kỳ vọng Gross PnL (lợi nhuận gộp). Thay vì tách biệt rõ ràng giữa `grossPnl` và `netPnl` hoặc cập nhật assert của test, file test đã bị loại bỏ khỏi `package.json` và CI pipeline để "giấu lỗi".
- **Tác động (Impact):**
  Người dùng xem PnL không phân biệt được phí đã bị trừ bao nhiêu; hiển thị PnL chưa nhất quán với công thức tính gốc; CI bị vô hiệu hóa lớp kiểm tra portfolio.
- **Đề xuất khắc phục (Fix proposal):**
  Tách `PortfolioPosition` và `PortfolioTrade` để có cả `grossPnl`, `netPnl`, và `feesPaid`. Cho phép người dùng chuyển đổi xem Gross / Net trên UI. Cập nhật unit test để kiểm tra chính xác cả hai chỉ số.
- **Regression test & Tiêu chuẩn nghiệm thu:**
  Chạy `portfolio.test.ts` xanh 100%, bảo đảm không có lỗi chia cho 0, phí bằng 0 khi không cấu hình, và PnL gộp trừ phí đúng bằng PnL ròng.

---

### BUG-02: Khẳng định mâu thuẫn trong Chat Message Component Test
- **Mức độ:** **P1 (High)**
- **Trạng thái:** `CONFIRMED`
- **Module / File:** `src/components/agent/__tests__/chat-message.test.tsx` (dòng 38–42)
- **Bằng chứng & Tái hiện:**
  ```bash
  node --import tsx --import ./test/test-setup/register-stub.mjs --require ./test/test-setup/patch-server-only.cjs --test src/components/agent/__tests__/chat-message.test.tsx
  ```
  Lỗi: `AssertionError [ERR_ASSERTION]: The input did not match the regular expression /<img/.`
- **Nguyên nhân gốc:**
  Code test viết:
  ```typescript
  test("answer text is never emitted as raw HTML", () => {
    const html = render({ id: "a3", role: "agent", text: "<img src=x onerror=alert(1)>", ts: 1 });
    assert.ok(!html.includes("<img"), "raw tag must be escaped");
    assert.match(html, /<img/); // Mâu thuẫn trực tiếp với dòng trên!
  });
  ```
  Dòng trên vừa khẳng định HTML không được chứa `<img`, dòng dưới lại assert regex `/<img/`. Đáng lẽ phải là `assert.match(html, /&lt;img/);`. File test này vì thế cũng bị bỏ ra ngoài CI.
- **Tác động:**
  Không có test hồi quy tự động bảo vệ cơ chế sanitize chống XSS của AI chat component trên frontend.
- **Đề xuất khắc phục:**
  Sửa assertion thành `assert.match(html, /&lt;img/)` và đưa file vào script `npm test` cũng như workflow CI.
- **Tiêu chuẩn nghiệm thu:**
  Toàn bộ 7 tests trong `chat-message.test.tsx` đạt, xác minh ký tự HTML nguy hiểm luôn được escape thành entity an toàn.

---

### BUG-03: Bỏ qua kiểm tra thu hồi phiên (Session Revocation Bypass) trong Auth
- **Mức độ:** **P1 (High - Security)**
- **Trạng thái:** `CONFIRMED`
- **Module / File:** `src/lib/auth.ts` (dòng 121–139) và `src/app/api/v1/auth/sessions/route.ts`
- **Bằng chứng (Code review):**
  Trong `src/lib/auth.ts`:
  ```typescript
  export async function getSessionUser(): Promise<SessionUser | null> {
    try {
      const jar = await cookies();
      const token = jar.get(COOKIE)?.value;
      if (!token) return null;
      const { payload } = await jwtVerify(token, getKey());
      if (!payload.sub) return null;
      const hash = sha256(token);
      const [row] = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.tokenHash, hash), gt(sessions.expiresAt, new Date())))
        .limit(1)
        .catch(() => []);
      return { id: payload.sub, sessionId: row?.id };
    } catch {
      return null;
    }
  }
  ```
- **Nguyên nhân gốc:**
  Khi người dùng bấm "Đăng xuất thiết bị" hoặc "Thu hồi phiên" trong Security Settings (`DELETE /api/v1/auth/sessions`), bản ghi trong DB bị xóa (`DELETE FROM sessions`). Tuy nhiên, hàm `getSessionUser()` vẫn trả về `{ id: payload.sub, sessionId: undefined }` ngay cả khi `row` là `undefined`! Ở các API route chỉ kiểm tra `if (!session) return 401;`, đối tượng này vẫn được coi là hợp lệ!
- **Tác động:**
  Một token JWT đã bị người dùng thu hồi vẫn có thể tiếp tục truy cập API trong vòng 7 ngày cho đến khi JWT hết hạn tự nhiên.
- **Đề xuất khắc phục:**
  Khi cơ sở dữ liệu đã cấu hình (`databaseConfigured()`), nếu không tìm thấy `row` trong bảng `sessions` (hoặc phiên đã hết hạn trong DB), hàm `getSessionUser()` bắt buộc phải trả về `null`.
- **Tiêu chuẩn nghiệm thu:**
  Tạo test case: Tạo session → verify ok → xóa record khỏi DB → gọi `getSessionUser()` phải trả về `null` (401 Unauthorized).

---

### BUG-04: AI Agent Router chỉ nhận diện 16 mã cổ phiếu cố định (Hardcoded Tickers)
- **Mức độ:** **P1 (High)**
- **Trạng thái:** `CONFIRMED`
- **Module / File:** `src/lib/services/agent-router.ts` (dòng 48–66)
- **Bằng chứng:**
  ```typescript
  const KNOWN_STOCKS = new Set([
    "FPT", "CMG", "VCB", "TCB", "HPG", "MWG", "SSI", "GAS", "VIC", "VHM", "MBB", "CTG", "BID", "VPB", "VNM", "MSN"
  ]);
  ```
- **Nguyên nhân gốc:**
  Danh sách `KNOWN_STOCKS` chỉ có 16 mã VN30 tiêu biểu. Khi người dùng hỏi về các mã quan trọng khác như `DGC`, `PVD`, `REE`, `KDH`, `STB`, `VRE`, `POW`, `PC1`..., router không nhận diện được symbol cổ phiếu, dẫn đến phân loại sai intent (rơi về general hoặc market) thay vì route chuyên sâu stock analyst.
- **Tác động:**
  Hầu hết các câu hỏi về cổ phiếu ngoài top 16 không kích hoạt được pipeline thu thập dữ liệu BCTC, định giá và phân tích kỹ thuật của mã đó.
- **Đề xuất khắc phục:**
  Tích hợp `KNOWN_STOCKS` trực tiếp với `SECURITY_MASTER` từ `src/lib/vn/master.ts` (đã có sẵn hơn 1,600 mã chứng khoán HOSE, HNX, UPCoM).
- **Tiêu chuẩn nghiệm thu:**
  Bổ sung smoke test kiểm tra các mã ngoài top 16 (`DGC`, `PVD`, `KDH`) được route chính xác về domain `stock`.

---

### BUG-05: Lỗ hổng phân quyền Ops & System API khi chưa cấu hình `ADMIN_EMAILS`
- **Mức độ:** **P1 (High - Security)**
- **Trạng thái:** `CONFIRMED`
- **Module / File:** `src/lib/internal-api-auth.ts` (dòng 9–22)
- **Bằng chứng:**
  ```typescript
  export async function requireInternalSession(): Promise<Response | null> {
    const session = await getSessionUser();
    if (!session) return fail("UNAUTHORIZED", "Đăng nhập để truy cập API vận hành", 401);
    const allow = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (!allow.length) return null; // <-- NGUY HIỂM: nếu ADMIN_EMAILS trống, cho phép mọi user!
    ...
  }
  ```
- **Nguyên nhân gốc:**
  Logic thiết kế fail-open: nếu biến môi trường `ADMIN_EMAILS` chưa được thiết lập, bất kỳ ai đăng ký tài khoản thông thường đều được cấp quyền gọi tất cả các API vận hành nội bộ (`/api/v1/system/*`, `/api/v1/ops/*`).
- **Tác động:**
  Người dùng vãng lai có thể xem thông tin server, tình trạng kết nối, độ trễ và các nhật ký xác thực nội bộ.
- **Đề xuất khắc phục:**
  Trong môi trường `production`, nếu `ADMIN_EMAILS` chưa cấu hình, mặc định từ chối (`fail("FORBIDDEN", ..., 403)`) hoặc chỉ cho phép trong môi trường `development`.
- **Tiêu chuẩn nghiệm thu:**
  Test gọi API `/api/v1/system/info` với user thường khi `ADMIN_EMAILS` chưa set → trả về 403 Forbidden thay vì 200.

---

### BUG-06: Cơ sở dữ liệu tồn tại bảng Watchlist mồ côi (Orphaned DB Tables)
- **Mức độ:** **P2 (Medium)**
- **Trạng thái:** `CONFIRMED`
- **Module / File:** `src/db/schema.ts` (dòng 35–49) và `src/app/watchlist/page.tsx`
- **Bằng chứng:**
  Hai bảng `watchlists` và `watchlistItems` đã được định nghĩa trong schema Drizzle nhưng không có bất kỳ API route nào đọc hay ghi vào hai bảng này. Trang `/watchlist` hoạt động 100% trên `window.localStorage`.
- **Nguyên nhân gốc:**
  Tính năng watchlist chưa hoàn tất việc kết nối giữa frontend và backend database.
- **Tác động:**
  Người dùng đăng nhập trên thiết bị khác bị mất danh sách theo dõi. Schema DB chứa cấu trúc thừa không sử dụng.
- **Đề xuất khắc phục:**
  Xây dựng cặp API `GET /api/v1/watchlist` và `POST /api/v1/watchlist` đồng bộ 2 chiều giữa localStorage và database khi người dùng đã đăng nhập.
- **Tiêu chuẩn nghiệm thu:**
  Thêm mã vào watchlist trên desktop → đăng nhập trên mobile thấy danh sách được đồng bộ.

---

### BUG-07: CI Pipeline loại trừ hơn 60% test suite
- **Mức độ:** **P2 (Medium)**
- **Trạng thái:** `CONFIRMED`
- **Module / File:** `.github/workflows/ci.yml` (dòng 41)
- **Bằng chứng:**
  CI chỉ khai báo chạy 10 test files. 15 test files còn lại hoàn toàn không được chạy khi tạo Pull Request hoặc Push code lên nhánh chính.
- **Tác động:**
  Lỗi hồi quy ở các module CANSLIM, Money Flow, MTF Bias, HTTP Cache, Cron Auth và AI format không bị phát hiện bởi CI.
- **Đề xuất khắc phục:**
  Đồng bộ hóa lệnh test của CI với toàn bộ test suite hoàn chỉnh sau khi giải quyết xong BUG-01 và BUG-02.
- **Tiêu chuẩn nghiệm thu:**
  Tất cả 25 file test đều chạy trên GitHub Actions và đạt 100%.

---

### BUG-08: Rò rỉ thông báo ngoại lệ máy chủ (Error Disclosure) tại Auth Login
- **Mức độ:** **P2 (Medium - Security)**
- **Trạng thái:** `CONFIRMED`
- **Module / File:** `src/app/api/v1/auth/login/route.ts` (dòng 28)
- **Bằng chứng:**
  ```typescript
  } catch (e) {
    return fail("LOGIN_FAILED", e instanceof Error ? e.message : "unknown", 500);
  }
  ```
- **Tác động:**
  Nếu kết nối database gặp sự cố (ví dụ lỗi SSL, timeout, lỗi kết nối chứa URL/user Postgres), `e.message` sẽ trả nguyên văn về client trong JSON response.
- **Đề xuất khắc phục:**
  Chỉ trả về thông báo chung: `"Đã xảy ra lỗi máy chủ, vui lòng thử lại sau"`, ghi chi tiết lỗi vào log nội bộ server.
- **Tiêu chuẩn nghiệm thu:**
  Khi cố tình gây lỗi kết nối DB, client nhận lỗi 500 với mã `INTERNAL_ERROR` không chứa chuỗi kỹ thuật nhạy cảm.

---

### BUG-09: Cấu trúc SwingPoint trong Money Flow thiếu chỉ số xác nhận (Look-ahead Risk)
- **Mức độ:** **P2 (Medium)**
- **Trạng thái:** `SUSPECTED`
- **Module / File:** `src/lib/engines/money-flow.ts` (dòng 63–69, 228–244)
- **Bằng chứng:**
  ```typescript
  export interface SwingPoint {
    index: number;
    time: number;
    price: number;
    kind: SwingKind;
    type: "high" | "low";
  }
  ```
- **Nguyên nhân gốc:**
  Hàm `findSwings` tìm đỉnh/đáy bằng cửa sổ đối xứng `[i - halfWindow, i + halfWindow]`. Đỉnh tại nến `i` chỉ thực sự được xác nhận tại nến `i + halfWindow`. Tuy nhiên `SwingPoint` chỉ lưu `index: i` mà không có trường `confirmedAtIndex`.
- **Tác động:**
  Nếu một hệ thống backtesting hoặc engine tín hiệu thời gian thực quét qua danh sách `swings`, nó có nguy cơ sử dụng đỉnh/đáy trước khi nến xác nhận đóng (look-ahead bias / repainting).
- **Đề xuất khắc phục:**
  Bổ sung trường `confirmedAtIndex: i + halfWindow` và `isProvisional: boolean` vào `SwingPoint` theo đúng tiêu chuẩn mục 9 của tài liệu nâng cấp.
- **Tiêu chuẩn nghiệm thu:**
  Test xác nhận rằng không có tín hiệu vào lệnh nào được tạo ra tại nến `i` dựa trên một pivot chỉ được xác nhận tại nến `i + halfWindow`.

---

### BUG-10: Heuristic tỷ lệ đơn vị giá cổ phiếu VN tiềm ẩn sai số với Penny Stocks
- **Mức độ:** **P3 (Low)**
- **Trạng thái:** `SUSPECTED`
- **Module / File:** `src/lib/financial/vn-units.ts` (dòng 11–17)
- **Bằng chứng:**
  ```typescript
  export function vnPriceScale(priceQuote: number | null | undefined): VnPriceScale {
    if (typeof priceQuote !== "number" || !Number.isFinite(priceQuote) || priceQuote <= 0) {
      return 1_000;
    }
    return priceQuote < 500 ? 1_000 : 1;
  }
  ```
- **Nguyên nhân gốc:**
  Quy tắc giả định: nếu số nhập vào nhỏ hơn 500 thì đó là đơn vị nghìn đồng (ví dụ 50.5 tức 50,500 VND), còn >= 500 là đơn vị đồng nguyên bản. Trường hợp một cổ phiếu thị giá cực thấp (ví dụ cổ phiếu penny giao dịch ở giá 400 VND/cổ phiếu) sẽ bị nhân nhầm lên thành 400,000 VND.
- **Tác động:**
  Sai lệch nghiêm trọng thị giá và vốn hóa đối với các mã penny có thị giá dưới 500 đồng.
- **Đề xuất khắc phục:**
  Bổ sung metadata nguồn quote (ví dụ `quoteUnit: "VND" | "kVND"`) từ feed thay vì chỉ dựa vào ngưỡng giả định đơn thuần.
- **Tiêu chuẩn nghiệm thu:**
  Bổ sung test với mã penny giá 450 VND với feed khai báo rõ đơn vị.
