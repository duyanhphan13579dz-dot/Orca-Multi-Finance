# Hai trang dữ liệu kinh tế VietnamBiz

## Phạm vi độc lập

| Trang | API nội bộ | Nguồn duy nhất |
| --- | --- | --- |
| `/macro-economic` — Kinh tế vĩ mô | `GET /api/v1/macro-economic` | https://data.vietnambiz.vn/macro-economic |
| `/currency-interest-rate` — Lãi suất tiền tệ | `GET /api/v1/currency-interest-rate` | https://data.vietnambiz.vn/currency-interest-rate |

- Provider mới: `src/lib/providers/vietnambiz-economy.ts`.
- Service/cache mới: `src/lib/services/economy.ts`.
- Contract/helper chỉ dùng cho hai trang: `src/lib/economic-data.ts`.
- Giao diện riêng: `src/components/economic-data-page.tsx`, dùng design tokens hiện có (dark/light, density), `useApi` và cài đặt realtime hiện có.
- Chỉ thêm hai mục điều hướng vào `shell.tsx`; drawer di động có cuộn dọc để không che các mục cũ.
- Không đưa dữ liệu vào market snapshot, ticker, AI Agent, reports, chart, watchlist hoặc cron. Không thay đổi provider hàng hóa, Forex hay bất kỳ API cũ nào.
- Không thêm dependency, biến môi trường, API key hoặc database migration.

## Lấy và chuẩn hóa dữ liệu

Server gọi **trực tiếp đúng URL nguồn qua `httpText`** (timeout 10 giây/lần, retry 1 lần, health + circuit breaker). Browser chỉ gọi API nội bộ cùng origin; không gọi provider trực tiếp, không iframe, không thông qua proxy dữ liệu bên thứ ba.

Parser đọc bảng HTML được render sẵn trên trang nguồn, ánh xạ cột theo nhãn `Chỉ tiêu`, `Kỳ công bố`, `Kỳ hiện tại`, `Kỳ trước`, `Ngày công bố tiếp theo` (vĩ mô). Không đoán endpoint riêng hay quy đổi số liệu từ schema nội bộ `__NEXT_DATA__`. Các khối CSS/JS, SVG và hàng đo kích thước Ant Design được loại bỏ; không thực thi HTML/JS từ nguồn.

Mỗi chỉ tiêu giữ:
- `id`, `name`: tên từ nguồn và khóa chuẩn hóa.
- `period`, `frequency`: nguyên văn kỳ công bố và phân loại ngày/tháng/quý/năm để lọc. **Không tự chuyển kỳ thống kê thành ngày công bố**.
- `current`, `previous`: `{ text, value, isPercent }`. Số âm, số 0, dấu phẩy phân cách hàng nghìn và dấu chấm thập phân được hỗ trợ. Ô trống/không hợp lệ là `null`, không phải `0`.
- `nextRelease`: nguyên văn lịch công bố nguồn, hoặc `null`; không dự báo ngày tiếp theo.

Chênh lệch trên UI = kỳ hiện tại − kỳ trước. Nếu cả hai giá trị có `%`, hiển thị **điểm phần trăm (đpt)**, không tính phần trăm tương đối. Thiếu giá trị hoặc khác đơn vị thì không tính. Màu tăng/giảm không được diễn giải thành tốt/xấu cho nền kinh tế.

Hai trang có thẻ chỉ tiêu nổi bật, toàn bộ bảng nguồn, tìm kiếm tiếng Việt không dấu, lọc kỳ công bố, nút tải lại, trạng thái tải/lỗi/không có kết quả và cuộn ngang trên màn hình nhỏ. Đơn vị và cách ghi số giữ theo nguồn.

## Cache và provenance

Hai cache key và circuit độc lập:
- `economy:vietnambiz:macro-economic:v1` / `vietnambiz-macro-economic`.
- `economy:vietnambiz:currency-interest-rate:v1` / `vietnambiz-currency-interest-rate`.

Không dùng key/circuit `vietnambiz-data` của module hàng hóa.

- Cache TTL **15 phút**, gộp request đồng thời qua cache chung; lỗi nguồn dùng bản hợp lệ gần nhất tối đa **24 giờ**, gắn `STALE`, khi cache hiện có còn giữ bản đó. Cache in-memory không bền qua restart/cold start; Redis mirror hoạt động theo cơ chế chung sẵn có của dự án.
- Không có bản hợp lệ: API trả HTTP **502**, `UPSTREAM_UNAVAILABLE`, `meta.freshness: UNAVAILABLE`.
- Có một phần số liệu lỗi: giữ những chỉ tiêu đọc được, kèm `warnings`, `partial: true`, trạng thái `DEGRADED`.
- Không có mock/fallback dữ liệu trong production. Bảng mất cấu trúc hoặc không có giá trị hiện tại hợp lệ không được ghi đè cache tốt.
- `data.fetchedAt`, `meta.ingestedAt`, `meta.providerReceivedAt` giữ lần lấy nguồn thành công, **không đổi khi cache hit**.
- Nguồn chỉ ghi kỳ thống kê, không cung cấp timestamp xuất bản chính xác: `sourceTimestamp` và `ageMs` luôn `null`. FRESH/STALE chỉ đánh giá **lần đồng bộ**, được giải thích ngay trên UI và `meta.note`; **không gắn LIVE** hay đánh giá chỉ tiêu năm cũ là lỗi.
- Nút **Làm mới** tải lại API, vẫn tôn trọng TTL, không cho client bỏ qua cache/gây tải lên nguồn. Polling đi theo chính sách `useApi`/Settings hiện có.
- Dữ liệu có liên kết gốc và ghi nhận bản quyền **CTCP WiGroup**, liên kết **WiChart.vn**, **WiFeed.vn**.

Host triển khai cần cho phép HTTPS outbound đến `data.vietnambiz.vn:443`. Nếu môi trường chặn mạng/TLS hoặc nguồn đổi cấu trúc, hai trang hiển thị UNAVAILABLE/STALE độc lập; các module khác không phụ thuộc hai request này.

## Kiểm tra

```bash
npm run test:economy  # parser, giá trị/đơn vị, tìm kiếm, metadata, HTTP, cache, API contracts
npm test              # giữ nguyên suite chart/quality/freshness cũ
npm run typecheck
npm run build
```

Fixtures HTML thu gọn nằm tại `test/fixtures/vietnambiz-*.html`, chỉ phục vụ test; không được import vào ứng dụng production. Test HTTP giả lập tại biên `fetch`, không phụ thuộc mạng hay cấu hình tài khoản.
