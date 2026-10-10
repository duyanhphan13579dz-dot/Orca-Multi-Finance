# ORCA Multi-Finance — Data Provider Inventory (Phase 1)

Bảng phân loại, đánh giá hiện trạng và trạng thái kiểm chứng của toàn bộ các nhà cung cấp dữ liệu (32 nguồn) kết nối vào hệ thống ORCA Financial.

---

## 1. Nguyên tắc nghiệm thu dữ liệu
1. **HTTP 200 ≠ Dữ liệu chính xác:** Nhận được mã 200 chỉ chứng minh endpoint mở, không chứng minh payload có cấu trúc đúng, đơn vị hợp lệ hoặc dữ liệu không bị cũ.
2. **Phân cấp trạng thái kiểm chứng:**
   - `HTTP_PROBED`: Đã kiểm tra kết nối mạng qua HTTP probe (`npm run check:sources`), phản hồi < 2s.
   - `CODE_VERIFIED`: Đã có adapter code hoàn chỉnh với try/catch, fallback và mapping schema.
   - `DATA_VERIFIED`: Đã đối soát nội dung payload thực tế với dữ liệu thị trường thực tế.
   - `NOT_VERIFIED`: Chưa có điều kiện kiểm chứng payload thực tế.

---

## 2. Danh mục nhà cung cấp dữ liệu theo Domain

### 2.1. Cổ phiếu Việt Nam (Vietnam Equities)

| Provider | Endpoint chính | Vai trò | Tần suất / Độ mới | Trạng thái kiểm chứng | Độ trễ đo được | Fallback khi lỗi |
|---|---|:---:|:---:|:---:|:---:|---|
| **VNDirect Finfo (Universe)** | `https://api-finfo.vndirect.com.vn/v4/stocks` | PRIMARY | Hàng ngày | DATA_VERIFIED | ~476 ms | `SECURITY_MASTER` cục bộ |
| **VNDirect Finfo (BCTC/FS)** | `https://api-finfo.vndirect.com.vn/v4/financial_statements` | PRIMARY | Hàng quý / năm | DATA_VERIFIED | ~170 ms | VNStock Provider, ADF Official |
| **VNDirect DChart (OHLCV)** | `https://dchart-api.vndirect.com.vn/dchart/history` | PRIMARY | Intraday / Daily | DATA_VERIFIED | ~63 ms | VPS HistDatafeed, DNSE Entrade, SSI |
| **VNDirect Events** | `https://api-finfo.vndirect.com.vn/v4/events` | PRIMARY | Hàng ngày | HTTP_PROBED | ~201 ms | Cache stale |
| **VPS BGAPi** | `https://bgapidatafeed.vps.com.vn/getliststockdata/*` | FALLBACK / LIVE | Realtime (tick) | DATA_VERIFIED | ~30 ms | VNDirect DChart snapshot |
| **VPS HistDatafeed** | `https://histdatafeed.vps.com.vn/tradingview/history` | FALLBACK | Daily / Intraday | HTTP_PROBED | ~32 ms | VNDirect DChart |
| **DNSE Entrade Chart API** | `https://services.entrade.com.vn/chart-api/v2/ohlcs/stock` | FALLBACK | Daily | HTTP_PROBED | ~52 ms | VPS HistDatafeed |
| **SSI iBoard (History)** | `https://iboard.ssi.com.vn/dchart/api/history` | FALLBACK | Intraday / Daily | DATA_VERIFIED | ~118 ms | VNDirect DChart |
| **Vietcap IQ (Profile)** | `https://iq.vietcap.com.vn/api/iq-insight-service/v1/company/*` | FALLBACK | Hàng tuần / tháng | DATA_VERIFIED | ~159 ms | VNDirect Company Profile |
| **CafeF Market Feed** | `https://cafef.vn` | ENRICHMENT | Chậm 15 phút | HTTP_PROBED | ~27 ms | VPS BGAPi |
| **UBCKNN / ADF Portal** | Headless scraper / ADF Client | OFFICIAL BCTC | Kiểm toán năm | CODE_VERIFIED | Theo lượt quét | VNDirect Finfo |

---

### 2.2. Tiền mã hóa (Cryptocurrency)

| Provider | Endpoint chính | Vai trò | Tần suất / Độ mới | Trạng thái kiểm chứng | Độ trễ đo được | Fallback khi lỗi |
|---|---|:---:|:---:|:---:|:---:|---|
| **Binance Vision (Spot)** | `https://data-api.binance.vision/api/v3/ticker/price` | PRIMARY | Realtime (1–5s) | DATA_VERIFIED | ~268 ms | Binance api.binance.com |
| **Binance REST Main** | `https://api.binance.com/api/v3/ticker/price` | PRIMARY | Realtime (1–5s) | DATA_VERIFIED | ~207 ms | Binance api1 Failover |
| **Binance REST Failover**| `https://api1.binance.com/api/v3/ticker/price` | PRIMARY | Realtime (1–5s) | DATA_VERIFIED | ~270 ms | OKX Spot Tickers |
| **Binance Futures (fapi)** | `https://fapi.binance.com/fapi/v1/premiumIndex` | PRIMARY | Realtime | DATA_VERIFIED | ~105 ms | Cache stale |
| **OKX Spot Tickers** | `https://www.okx.com/api/v5/market/tickers?instType=SPOT` | FALLBACK | Realtime (5–10s) | DATA_VERIFIED | ~147 ms | CoinGecko Demo |
| **CoinGecko API (Demo)** | `https://api.coingecko.com/api/v3/simple/price` | FALLBACK | 1–5 phút | HTTP_PROBED | ~327 ms | Yahoo Finance Crypto |
| **Yahoo Finance Crypto** | Yahoo Query API | ENRICHMENT | 1–5 phút | HTTP_PROBED | ~118 ms | Cache stale |

---

### 2.3. Ngoại hối & Tỷ giá (Forex)

| Provider | Endpoint chính | Vai trò | Tần suất / Độ mới | Trạng thái kiểm chứng | Độ trễ đo được | Fallback khi lỗi |
|---|---|:---:|:---:|:---:|:---:|---|
| **Biquote Public MT5** | MT5 streaming / polling feed | PRIMARY | Intraday (1–10s) | DATA_VERIFIED | ~1,055 ms | Yahoo Finance FX |
| **ExchangeRate-API Open** | `https://open.er-api.com/v6/latest/*` | FALLBACK | Daily | HTTP_PROBED | ~91 ms | Frankfurter ECB |
| **Frankfurter ECB** | `https://api.frankfurter.app/latest` | FALLBACK | Daily reference | HTTP_PROBED | ~103 ms | ExchangeRate-API |
| **Yahoo Finance FX** | `EURUSD=X`, `USDVND=X` | FALLBACK | 1–5 phút | HTTP_PROBED | ~71 ms | Biquote MT5 |

---

### 2.4. Hàng hóa & Năng lượng (Commodities)

| Provider | Endpoint chính | Vai trò | Tần suất / Độ mới | Trạng thái kiểm chứng | Độ trễ đo được | Fallback khi lỗi |
|---|---|:---:|:---:|:---:|:---:|---|
| **VietnamBiz Goods Catalog** | `https://data.vietnambiz.vn` | PRIMARY | Theo phiên / ngày | DATA_VERIFIED | ~252 ms | Yahoo Futures |
| **Yahoo Finance Futures** | `GC=F`, `SI=F`, `CL=F`, `BZ=F` | ENRICHMENT | 5–15 phút | CODE_VERIFIED | ~100 ms | Cache stale |

---

### 2.5. Kinh tế vĩ mô & Lãi suất (Macroeconomics)

| Provider | Endpoint chính | Vai trò | Tần suất / Độ mới | Trạng thái kiểm chứng | Độ trễ đo được | Fallback khi lỗi |
|---|---|:---:|:---:|:---:|:---:|---|
| **World Bank Open Data** | `https://api.worldbank.org/v2/country/*` | PRIMARY | Hàng năm | DATA_VERIFIED | ~200 ms | Cache cục bộ |
| **State Bank of Vietnam (NHNN)** | `https://sbv.gov.vn` | PRIMARY | Hàng ngày | HTTP_PROBED | ~48 ms | Cache stale |
| **FRED St. Louis Fed** | St. Louis Fed FRED API | ENRICHMENT | Hàng tháng / quý | HTTP_PROBED | ~115 ms | Cache stale |

---

### 2.6. Tin tức & Báo chí (Financial News RSS)

| Provider | Nguồn / URL RSS | Tần suất | Trạng thái kiểm chứng | Độ trễ đo được |
|---|---|:---:|:---:|:---:|
| **CafeF RSS** | `https://cafef.vn/thi-truong-chung-khoan.rss` | 10–15 phút | DATA_VERIFIED | ~79 ms |
| **VnExpress RSS** | `https://vnexpress.net/rss/kinh-doanh.rss` | 10–15 phút | DATA_VERIFIED | ~48 ms |
| **VietnamBiz RSS** | `https://vietnambiz.vn/tai-chinh.rss` | 15–30 phút | DATA_VERIFIED | ~205 ms |
| **Tuổi Trẻ RSS** | `https://tuoitre.vn/rss/kinh-doanh.rss` | 15–30 phút | DATA_VERIFIED | ~84 ms |
| **BBC Vietnamese Business** | BBC News Tiếng Việt RSS | 1 giờ | HTTP_PROBED | ~1,153 ms |
| **CoinTelegraph RSS** | `https://cointelegraph.com/rss` | 10 phút | HTTP_PROBED | ~116 ms |
| **Google News (CK VN)** | Google News Search RSS | 15 phút | HTTP_PROBED | ~713 ms |

---

## 3. Đánh giá Circuit Breaker & Fallback Policy

1. **VNDirect Multi-host Failover:**
   - Hệ thống hỗ trợ cấu hình danh sách host dự phòng qua `VNDIRECT_FALLBACK_BASE_URLS`. Khi host chính gặp lỗi HTTP 5xx hoặc ECONNREFUSED, adapter tự động chuyển sang host phụ.
2. **Binance REST Failover:**
   - Luân chuyển tự động qua 3 endpoint: `data-api.binance.vision` → `api.binance.com` → `api1.binance.com`.
3. **Data Freshness Guards:**
   - Không chuyển dữ liệu cũ thành "Live". Khi nguồn chính gặp lỗi và phải dùng cache cũ, trường `meta.stale: true` luôn được bảo lưu để frontend hiển thị chỉ báo "Dữ liệu cũ" (warning banner/chip) thay vì lừa dối người dùng.
