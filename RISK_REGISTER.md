# ORCA Multi-Finance — Risk Register (Phase 1)

Bảng tổng hợp ma trận rủi ro kỹ thuật, dữ liệu, bảo mật và vận hành hạ tầng của hệ thống ORCA Financial.

---

## 1. Ma trận Rủi ro tổng quan

| Mã Rủi ro | Lĩnh vực | Mô tả rủi ro | Mức độ tác động | Xác suất xảy ra | Biện pháp giảm thiểu hiện hữu | Kế hoạch hành động đề xuất |
|---|:---:|---|:---:|:---:|---|---|
| **RISK-01** | Kiến trúc / Runtime | Giới hạn Serverless Cloudflare Workers: Bộ nhớ cache trong process (`Map`) không được chia sẻ giữa các isolate độc lập. | **Cao** | **Chắc chắn (100%)** | Đã có lớp hỗ trợ Upstash Redis REST mirror và TCP Redis. | Bắt buộc cấu hình `UPSTASH_REDIS_REST_URL` & `TOKEN` ở production để tránh cache stampede. |
| **RISK-02** | Dữ liệu / Upstream | Nhà cung cấp dữ liệu chính (VNDirect) chặn IP hoặc thay đổi cấu trúc JSON API không báo trước. | **Cao** | **Trung bình** | Hệ thống có cơ chế `VNDIRECT_FALLBACK_BASE_URLS` và fallback sang VPS/SSI/CafeF. | Mở rộng contract testing tự động kiểm tra schema response hàng ngày qua cron. |
| **RISK-03** | Bảo mật | Khóa `ADMIN_EMAILS` bị bỏ trống dẫn đến bất kỳ người dùng mới đăng ký nào cũng truy cập được `/system/*` và `/ops/*`. | **Nghiêm trọng** | **Cao** (nếu quên config) | Hàm `requireInternalSession` hiện tại kiểm tra danh sách email. | Chuyển sang cơ chế **fail-closed** ở production (mặc định cấm nếu biến trống). |
| **RISK-04** | Bảo mật | Token JWT bị thu hồi vẫn có thể tiếp tục sử dụng trong 7 ngày do hàm `getSessionUser` bỏ qua kiểm tra DB record. | **Nghiêm trọng** | **Cao** | Đã có bảng `sessions` lưu `tokenHash` trong Postgres. | Buộc `getSessionUser` trả về `null` khi bản ghi không tồn tại trong DB. |
| **RISK-05** | Cơ sở dữ liệu | Thiếu file migration Drizzle chính thức trong thư mục `drizzle/` (chỉ có 2 file manual SQL). | **Cao** | **Cao** | Có schema Drizzle hoàn chỉnh tại `src/db/schema.ts`. | Tạo kế hoạch sinh migration chuẩn (`drizzle-kit generate`) và kiểm tra trên staging có snapshot rollback trước khi chạy. |
| **RISK-06** | Dữ liệu / Độ mới | Gắn nhãn dữ liệu cũ (stale cache) thành dữ liệu realtime trên giao diện khi upstream lỗi. | **Cao** | **Trung bình** | Lớp `cache.ts` lưu trường `stale: true` và `producedAt`. | Kiểm tra toàn bộ UI components để đảm bảo luôn hiển thị badge "Dữ liệu cũ" khi `meta.stale === true`. |
| **RISK-07** | Định lượng / AI | LLM tự tạo số liệu tài chính hoặc định giá sai khi người dùng đặt câu hỏi nằm ngoài ngữ cảnh. | **Cao** | **Trung bình** | Prompt hệ thống có ràng buộc nghiêm ngặt cấm bịa số; yêu cầu trích dẫn nguồn. | Bổ sung hàm post-validation kiểm tra các con số do LLM tạo ra khớp với evidence context. |
| **RISK-08** | Giao diện / UX | Layout bảng biểu dày đặc bị tràn ngang (horizontal overflow) trên màn hình điện thoại hẹp (320px–375px). | **Trung bình** | **Trung bình** | Đã có đợt cập nhật responsive cơ bản trong `UI_AUDIT_REPORT.md`. | Kiểm tra toàn bộ các bảng nợ, lưu chuyển tiền tệ và bảng phái sinh trên ma trận viewport mobile. |
| **RISK-09** | Hạ tầng / Triển khai | Kết nối cơ sở dữ liệu qua PgBouncer transaction pooling của Neon xung đột với prepared statements của Drizzle. | **Cao** | **Trung bình** | Cấu hình `drizzle.config.ts` ưu tiên `DATABASE_URL_UNPOOLED` cho migration. | Sử dụng Cloudflare Hyperdrive ở tầng Worker để tối ưu hóa connection pooling an toàn. |

---

## 2. Kế hoạch ứng phó & Rollback

1. **Rollback Migration DB:** Mọi thay đổi cấu trúc bảng phải có script `down.sql` tương ứng và được backup dữ liệu trước khi chạy lệnh apply.
2. **Rollback Ứng dụng Cloudflare Workers:** Sử dụng tính năng Instant Rollback của Cloudflare Workers:
   ```bash
   npx wrangler rollback [deployment-id]
   ```
3. **Chế độ suy thoái an toàn (Graceful Degradation):**
   Khi mất kết nối cơ sở dữ liệu, `src/db/index.ts` kích hoạt `createMockDb()`, cho phép các tính năng đọc dữ liệu thị trường công khai tiếp tục hoạt động mà không làm sập toàn bộ ứng dụng.
