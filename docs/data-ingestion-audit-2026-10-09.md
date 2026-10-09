# Rà soát pipeline lấy dữ liệu — 2026-10-09

## Kết luận

Nguồn ưu tiên mà người dùng đề xuất **đã được nối vào các luồng hiện tại**:

- Hàng hóa: `https://data.vietnambiz.vn/goods` qua `src/lib/providers/commodities.ts`.
- Lãi suất tiền tệ: `https://data.vietnambiz.vn/currency-interest-rate` qua `src/lib/economic-data.ts` và `src/lib/providers/vietnambiz-economy.ts`.
- Kinh tế vĩ mô: `https://data.vietnambiz.vn/macro-economic` qua cùng adapter.

Hai trang kinh tế đọc bảng HTML server-rendered, kiểm tra đúng loại bảng/cột và không suy diễn giá trị khi thiếu. Dữ liệu kinh tế được cache 15 phút, cho phép stale tối đa 24 giờ; hiện lấy on-demand, không phụ thuộc cron. Nút thắt được tìm thấy chủ yếu ở **đường hàng hóa**, không phải do thiếu cấu hình nguồn VietnamBiz.

## Phát hiện theo mức độ ưu tiên

### P1 — Timeout không bao trùm response body (đã sửa)

`src/lib/http.ts` đặt AbortController cho request nhưng xóa timer ngay sau khi nhận response headers, trước `await res.text()`. Vì vậy trang có header nhanh nhưng body chậm/lớn có thể đọc kéo dài ngoài timeout và giữ request/cron chờ lâu. Điều này đặc biệt liên quan tới các trang Vietnambiz có HTML nhiều megabyte. Đo kiểm nhanh trong sandbox cho thấy trang goods tải nhiều megabyte và vượt cửa sổ quan sát 12 giây; hai trang kinh tế cũng có thời gian tải ở mức vài đến hơn 10 giây. Đây là phép đo tại thời điểm rà soát, không phải SLA cố định.

**Thay đổi:** giữ timeout hoạt động cho tới khi đọc xong body. Timeout fetch hiện phản ánh trọn request thay vì chỉ thời gian chờ headers.

### P1 — Cold start hàng hóa tuần tự tải cùng một trang hai lần (đã sửa)

Trước đây, khi chưa có build ID, `fetchVietnambizGoods()` tải toàn bộ HTML `/goods` để dò ID; sau đó mới tải `_next/data/{buildId}/goods.json`. Hai request nối tiếp, dù HTML đầu tiên đã chứa `__NEXT_DATA__` với dữ liệu có thể dùng trực tiếp. Khi lỗi, retry nhiều vòng và fallback lại HTML còn làm tăng thời gian/chồng request. Mỗi isolate Cloudflare mới lại chịu cold-start này.

**Thay đổi:** khi isolate có build ID còn hạn, gọi JSON nhỏ trước; nếu isolate lạnh hoặc build ID lỗi/đổi, tải HTML đúng một lần rồi dùng luôn dữ liệu đã nhúng và cập nhật build ID. Giảm timeout/retry riêng cho hai đường dữ liệu để không tiêu hết ngân sách cron 60 giây.

### P2 — Yahoo là enrichment tùy chọn nhưng chặn phản hồi hàng hóa (đã giảm)

`fetchAll()` chờ `Promise.all()` của VietnamBiz và Yahoo; phần Yahoo có tối đa 6 giây chờ dù dữ liệu nguồn chính đã về. Điều này làm tăng độ trễ cache miss/cron khi Yahoo chậm.

**Thay đổi:** giảm cửa sổ chờ enrichment xuống 1,2 giây và giải phóng timer sau khi có kết quả. Hàng hóa VietnamBiz tiếp tục là nguồn giá chính; Yahoo chỉ bổ sung provenance/đối chiếu nếu phản hồi đủ nhanh.

### P2 — Cron hiện chỉ làm mới hàng hóa

`/api/v1/cron/commodities` gọi `refreshCommodityMarket()`; các bảng lãi suất/vĩ mô hiện làm mới on-demand qua cache khi endpoint được truy cập. Điều này không sai với số liệu công bố định kỳ, nhưng lượt truy cập đầu tiên sau khi hết TTL vẫn phải chờ upstream.

**Khuyến nghị:** nếu muốn giao diện luôn có cache nóng sau lúc triển khai/isolate lạnh, thêm cron warm riêng cho hai dataset kinh tế. Không thêm tự động trong lần sửa này để tránh tăng tần suất request cho nguồn vốn công bố theo ngày/tháng/quý.

### P2 — Lịch sử lưu hàng hóa có thể phình và có dữ liệu trùng (chưa sửa)

`persistQuotes()` thêm các hàng mới vào `commodity_quotes` mỗi lần cron chạy; schema hiện chỉ có index `symbol`, không thấy khóa chống trùng theo mặt hàng + thời điểm nguồn, và không thấy retention trong đường này. Ngoài ra persistence chạy fire-and-forget. Đây không phải nguyên nhân upstream bị nghẽn nhưng có thể làm tăng chi phí/độ trễ database theo thời gian và khiến cùng một kỳ nguồn xuất hiện nhiều lần.

**Khuyến nghị:** quyết định rõ đây là bảng lịch sử hay bảng snapshot mới nhất; với lịch sử, thêm unique key/upsert phù hợp (ví dụ mã hàng + `source_timestamp`) và retention; với snapshot, cập nhật theo mã hàng thay vì insert vô hạn. Việc chọn chính sách cần xác nhận nghiệp vụ/lịch sử mong muốn nên chưa tự đổi schema.

### P3 — Tài liệu provider không còn khớp mã nguồn (đã sửa)

`docs/data-providers.md` mô tả catalog/fallback hàng hóa cũ (Simplize/MSN/Binance), trong khi adapter hiện dùng VietnamBiz Data; cập nhật tài liệu cho khớp thực tế.

## Đường dữ liệu hiện tại

1. API hàng hóa → `getCommodityMarket()` → cache `commodities:vnb-data-goods` (TTL 10 phút, stale window khai báo 24 giờ) → VietnamBiz primary + Yahoo enrichment best-effort.
2. API cron hàng hóa → `refreshCommodityMarket()` → invalidate cache → fetch lại → persist best-effort.
3. API lãi suất/vĩ mô → `getEconomicData(dataset)` → cache riêng từng bộ dữ liệu (TTL 15 phút) → parse bảng HTML của đúng URL VietnamBiz.
4. HTTP outbound → `src/lib/http.ts` cung cấp timeout, retry và provider health/circuit; lỗi body-read trước đây không chịu timeout đầy đủ, đã khắc phục.

## Các thay đổi trong lần rà soát

- Sửa timeout outbound bao trọn lúc đọc response body.
- Bỏ request HTML dò build ID riêng; cold isolate dùng luôn `__NEXT_DATA__`, warm isolate dùng JSON nhỏ.
- Bỏ retries lặp không cần thiết và hạ ngân sách timeout cho adapter hàng hóa.
- Giảm thời gian chờ Yahoo enrichment để nguồn phụ không giữ chậm hàng hóa chính.
- Sửa mô tả provider trong tài liệu.

## Kiểm thử / giới hạn

- Đã truy cập trực tiếp cả ba URL VietnamBiz trong lúc rà soát; trang goods có bảng mặt hàng, trang lãi suất có bảng chỉ tiêu, trang macro có bảng chỉ tiêu và lịch công bố.
- `npm test`: đạt, 34/34 kiểm thử.
- ESLint trên ba file TypeScript được sửa: đạt.
- `git diff --check`: đạt.
- `npm run typecheck`: chưa đạt toàn repository — 124 lỗi ở 52 file khác, phần lớn là mismatch thuộc tính/kiểu trong các module hiện hữu; không có lỗi được báo ở ba file TypeScript sửa trong lần này. Cần tách riêng việc xử lý type debt trước khi có thể dùng typecheck toàn cục làm cổng sạch.
- Các thay đổi trong sandbox chưa được commit/push và chưa deploy. Endpoint cron có yêu cầu `CRON_SECRET`; không gọi production trong lần rà soát này.
