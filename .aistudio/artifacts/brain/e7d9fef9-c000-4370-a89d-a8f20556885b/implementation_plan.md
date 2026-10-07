# Đề Xuất Cải Tiến Bố Cục Phân Hệ Crypto — Giữ Nguyên Hệ Màu & Template Hiện Tại

Kế hoạch nâng cấp và tái cấu trúc bố cục trang Tổng quan thị trường (`/crypto`) và Không gian giao dịch chi tiết (`/crypto/[symbol]`) thành một Crypto Trading Terminal chuyên nghiệp theo chuẩn Binance và Bybit, **bảo toàn trọn vẹn 100% bảng màu, theme tokens và phong cách nhận diện vốn có của ORCA**.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> **Yêu cầu đã được cập nhật từ phản hồi của bạn:**
> - **Giữ nguyên Template Color**: Tuyệt đối không thay đổi bảng màu, giữ trọn vẹn toàn bộ hệ thống biến CSS / Tailwind tokens hiện tại của dự án (`--color-canvas`, `--color-panel`, `--color-surface-elevated`, `--color-border-subtle`, `--color-text-primary`, `--color-text-secondary`, `--color-text-muted`, `--color-accent-primary`, `--color-positive`, `--color-negative`, v.v.) cũng như cơ chế hỗ trợ 2 chế độ Dark / Light qua `data-theme`.
> - **Trọng tâm thay đổi**: Chỉ tập trung tái cấu trúc không gian, phân chia layout dạng cột logic, tăng độ trực quan và tính tiện dụng của các khối thông tin (Biểu đồ, Sổ lệnh, Scalp, Tin tức).

- **Quyết định 1 (Phạm vi đồng bộ)**: Nâng cấp cả **Trang tổng quan thị trường** (`/crypto`) và **Trang chi tiết coin** (`/crypto/[symbol]`).
- **Quyết định 2 (Bảo toàn màu sắc & Component classes)**: Sử dụng các class chuẩn của ứng dụng (`panel`, `panel-elevated`, `panel-inset`, `seg`, `num`, `row-hover`, v.v.) nhằm đảm bảo sự liền mạch thị giác với các trang khác (Cổ phiếu VN, Ngoại hối, Hàng hóa).
- **Quyết định 3 (Bố cục 3 cột tương thích màn hình)**: Trên Desktop hiển thị 3 cột liền mạch (Sổ lệnh - Biểu đồ - Scalping & Đòn bẩy); trên Mobile tự động co về giao diện tab thông minh không cần cuộn dài.

---

## 1. Overview & Core Concept

- **Mục tiêu**: Giữ nguyên nhận diện màu sắc đặc trưng của ORCA, tổ chức lại luồng hiển thị thành trạm giao dịch định lượng (Quant Trading Desk) mạch lạc, cho phép quan sát biểu đồ nến, tín hiệu scalping, sổ lệnh và tin tức cùng lúc.
- **Đối tượng sử dụng**: Nhà đầu tư crypto, trader giao dịch lướt sóng (scalper) và phân tích dòng tiền lớn.
- **Giá trị cốt lõi**:
  1. Loại bỏ tình trạng thông tin bị dàn trải thành nhiều tầng cuộn dọc gây đứt gãy tầm nhìn.
  2. Bố cục bảng giá tổng quan có độ rộng thị trường rõ ràng, dễ lọc mã tiềm năng.
  3. Không gian giao dịch chi tiết trực quan, cân đối và đồng bộ hoàn toàn với thẩm mỹ hiện tại của trang web.

---

## 2. User Experience & Visual Design

### A. Trang Tổng Quan Thị Trường (`/crypto`)
Tái cấu trúc thành **Market Discovery Board**:
1. **Thanh Thống Kê Độ Rộng Thị Trường (Market Breadth Strip)**:
   - Thẻ BTC 24h & ETH 24h hiển thị biến động và mức giá hiện thời với class `num`.
   - Độ rộng thị trường: Số mã tăng (`text-positive` / `text-up`) vs Số mã giảm (`text-negative` / `text-down`) kèm thanh hiển thị tỷ lệ trực quan.
   - Tổng khối lượng giao dịch USDT toàn sàn và mức thay đổi bình quân thị trường.
2. **Bộ Lọc Động & Ô Tìm Kiếm Nhanh**:
   - Các nút lọc dạng Segmented control chuẩn của ứng dụng: `Tất cả`, `Vol lớn`, `Tăng mạnh`, `Giảm mạnh`.
   - Ô tìm kiếm mã coin tức thì với phím xóa nhanh và icon tìm kiếm tinh gọn.
3. **Bảng Giá Toàn Thị Trường (Data Grid)**:
   - Giữ nguyên cấu trúc bảng với các class `row-hover`, `border-border-subtle`, hiển thị: Thứ hạng, Mã token (có ký hiệu baseAsset/USDT), Giá hiện tại, % Biến động 24h, Biên độ ngày (Low - High), Khối lượng quote volume, Nhãn trạng thái xu hướng.
   - Hỗ trợ xem mượt mà trên cả desktop (dạng bảng đầy đủ) và mobile (dạng danh sách thẻ rút gọn dễ chạm).

### B. Trang Chi Tiết Giao Dịch (`/crypto/[symbol]`)
Tái cấu trúc thành **Pro Cockpit 3 Cột**:
1. **Thanh Ticker Điều Khiển Cố Định (Sticky Top Bar)**:
   - Sử dụng thẻ `panel` hoặc thanh header viền mỏng `border-border-subtle` nền `bg-surface-primary`.
   - Tên cặp tiền (`BTC/USDT`), giá giao dịch lớn nổi bật, % thay đổi 24h.
   - Thống kê 24h: Giá cao nhất (High 24h), Giá thấp nhất (Low 24h), Volume quy đổi và Số lượng giao dịch.
   - Bộ chọn khung thời gian nến (`15m`, `1h`, `4h`, `1d`) và nút Theo dõi Watchlist.
2. **Khu Vực Trung Tâm (Center Stage - 3 Cột Desktop)**:
   - **Cột Trái (Order Book & Flow Desk - 3/12 cols)**:
     * Sổ lệnh 2 chiều (Asks ở trên, Bids ở dưới, mức giá khớp giữa ở giữa) với nền thanh phần trăm khớp lệnh màu xanh/đỏ chuẩn của template (`rgba(46,194,126,0.12)` và `rgba(238,95,117,0.12)`).
     * Luồng khớp lệnh lớn (Aggregated Trades) hiển thị các lệnh mua/bán áp đảo của cá mập.
     * Tỷ lệ chênh lệch sổ lệnh (Book Imbalance) và spread bps.
   - **Cột Giữa (Main Chart Canvas - 6/12 cols)**:
     * Biểu đồ nến kỹ thuật `OrcaChart` với kích thước chiều cao cân đối (~440px - 480px), đầy đủ các công cụ vẽ, chỉ báo RSI, Volume, MACD.
   - **Cột Phải (Scalping Radar & Leverage Simulator - 3/12 cols)**:
     * Bảng tín hiệu Scalp thời gian thực (`WATCH LONG` màu `text-positive`, `WATCH SHORT` màu `text-negative`).
     * Vùng vào lệnh (Entry Zone), Điểm cắt lỗ vô hiệu hóa (Invalidation), Hỗ trợ / Kháng cự vi mô.
     * Thanh trượt đòn bẩy trực quan (0x - 200x slider) tính toán ngay điểm Entry, Stop Loss, Take Profit, Tỷ lệ R:R và Giá thanh lý ước tính.
3. **Khu Vực Bổ Trợ Dưới Cùng (Bottom Cockpit - 3 Cột Ngang Đều Nhau)**:
   - **Khối 1: Phân Tích Kỹ Thuật (Technical Panel)**: Chỉ báo RSI, Trend status, SMA50, các thông số dao động.
   - **Khối 2: Tâm Lý Thị Trường & Mẫu Hình Nến**: Thước đo tâm lý (Bi quan - Trung tính - Lạc quan) và các mẫu hình nến đảo chiều (Bullish/Bearish Engulfing, Hammer, Doji...).
   - **Khối 3: Luồng Tin Tức Crypto (News Flow)**: Danh sách các bài báo, tin tức thời gian thực gắn thẻ liên quan tới đồng coin đang xem.

### C. Giữ Nguyên 100% Template Color & Design System
- **Các biến màu được giữ nguyên vẹn**:
  - Nền chính: `bg-canvas` / `var(--color-canvas)`
  - Khung và thẻ: `panel`, `bg-surface-primary`, `bg-surface-elevated`
  - Viền: `border-border-subtle`, `border-line`
  - Chữ: `text-text-primary`, `text-text-secondary`, `text-text-muted`
  - Màu tăng/giảm: `text-positive` / `text-up` (xanh), `text-negative` / `text-down` (đỏ), `text-warning` / `text-warn` (vàng)
  - Màu nhấn chính: `text-accent-primary` / `bg-accent-primary` (xanh dương ORCA)
- **Kiểu chữ**: Giữ nguyên `font-mono tabular-nums` cho mọi con số để căn lề chuẩn xác.

---

## 3. Key Product Decisions & Trade-Offs

- **Quyết định 1: Giữ nguyên template styling tokens, không cài thêm thư viện CSS**:
  - *Lý do*: Đảm bảo tính nhất quán tuyệt đối trong toàn bộ ứng dụng ORCA, thời gian build nhanh, không làm vỡ các trang khác.
- **Quyết định 2: Đưa Sổ Lệnh lên ngang hàng với Biểu Đồ Nến**:
  - *Lý do*: Tạo trải nghiệm Trading Desk thực thụ. Người dùng có thể nhìn thấy biến động giá nến và các bức tường mua/bán (Bids/Asks walls) cùng lúc.
- **Quyết định 3: Thiết kế Mobile thông minh qua Tabbed View**:
  - *Lý do*: Màn hình điện thoại không đủ chiều ngang để hiển thị 3 cột cùng lúc. Thay vì xếp chồng thành một trang quá dài, người dùng điện thoại sẽ có các tab: `[Biểu đồ]` `[Sổ lệnh]` `[Scalp]` `[Tin tức]` để xem nhanh một chạm.

---

## 4. Technical Architecture & Data Strategy

### A. Sơ Đồ Cấu Trúc Bố Cục (ASCII Layout Diagram)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Crypto Market Page (/crypto) — Template Color Preserved                      │
├──────────────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ Top Stat Grid: BTC 24h | ETH 24h | Độ rộng (Tăng/Giảm) | Tổng Vol 24h    │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ Filter & Search: Segmented Tabs (Vol lớn, Tăng, Giảm) + Search Input     │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ Pro Table: Hạng, Token, Giá, 24h %, Biên 24h, Quote Vol, Trạng thái     │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ Crypto Detail Trading Terminal (/crypto/[symbol])                            │
├──────────────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ Top Sticky Ticker: Base/USDT, Live Price, 24h High/Low/Vol, Timeframes   │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────┬───────────────────────────────┬────────────────────┐ │
│ │ Sổ lệnh & Dòng tiền │ Biểu đồ nến chính             │ Scalp Radar &      │ │
│ │ (Col 1: ~25%)       │ (Col 2: ~50%)                 │ Mô phỏng đòn bẩy   │ │
│ │ - Sổ lệnh Bids/Asks │ - OrcaChart (Live Candles)    │ (Col 3: ~25%)      │ │
│ │ - Khớp lệnh lớn     │ - Nút chọn khung thời gian    │ - Tín hiệu Long/Sh │ │
│ │ - Tỷ lệ Imbalance   │ - Hỗ trợ / Kháng cự           │ - Entry / SL / TP  │ │
│ │                     │                               │ - Slider đòn bẩy   │ │
│ └─────────────────────┴───────────────────────────────┴────────────────────┘ │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ Bottom Analytics (Grid 3 cột cân đối):                                   │ │
│ │ ┌───────────────────────┬───────────────────────┬──────────────────────┐ │ │
│ │ │ Phân tích kỹ thuật    │ Tâm lý & Mẫu nến      │ Luồng tin tức Crypto │ │ │
│ │ │ RSI, SMA50, Xu hướng  │ Thước đo + Nến đảo ch │ Tin RSS mới nhất     │ │ │
│ │ └───────────────────────┴───────────────────────┴──────────────────────┘ │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Các Bước Triển Khai Sau Khi Được Duyệt

1. **Bước 1**: Cải tiến `src/components/crypto-market.tsx` — Nâng cấp thanh độ rộng thị trường, bộ lọc động và bảng giá giữ nguyên hệ màu template.
2. **Bước 2**: Tái cấu trúc `src/components/crypto-detail.tsx` — Xây dựng lưới 3 cột chuyên nghiệp cho phần trên, tích hợp thanh điều khiển Ticker và nhóm 3 khối kỹ thuật/tâm lý/tin tức ở phần dưới.
3. **Bước 3**: Tinh chỉnh `src/components/crypto-trade-desk.tsx` — Tối ưu kích thước hiển thị sổ lệnh và luồng lệnh lớn để vừa vặn hoàn hảo trong cột trái của Terminal.
4. **Bước 4**: Kiểm thử trên mọi kích thước màn hình (Desktop, Tablet, Mobile) và chạy `compile_applet` xác minh không có lỗi.
