# Data Providers

Mọi provider phía sau **Provider Adapter Interface** và bị metadata health giám sát:
`provider · status · last_success · last_failure · latency (last/EMA) · circuit · recent events`.

## Registry (priority)

| Domain | Primary | Fallbacks |
| --- | --- | --- |
| stocks (VN) | **SSI FastConnect v3** (env: `SSI_API_KEY`, `SSI_API_SECRET`) | SSI FC Data v2 legacy (`SSI_FC_CONSUMER_ID/SECRET`) → VNDirect (không cần key) → LEVEL-4 snapshot |

**LEVEL-4 snapshot (`vndirect-snapshot`)** — khi MỌI nguồn live đều không reachable, bảng giá/chỉ số/quotes VN phục vụ từ snapshot xác thực đóng cửa phiên (kéo nguyên văn từ `api-finfo.vndirect.com.vn`, xem `src/lib/providers/vn-board-snapshot.ts`): 100 mã thanh khoản cao nhất + 6 chỉ số, tên DN nguyên văn (thiếu thì để trống, không suy đoán). Meta ghi `source: vndirect-snapshot`, `freshness: STALE` và note "SNAPSHOT … phiên X" — không bao giờ giả làm dữ liệu live. Khi nguồn live hồi phục, ladder tự ưu tiên live trở lại.
| crypto | Binance spot REST (`api.binance.com` → `api{1,2}.binance.com` → `data-api.binance.vision`) | Binance fapi cho futures (geo-dependent) |
| forex | Biquote (env) | exchangerate-api open latest; Frankfurter/ECB daily history + previous fix |
| commodities | Vietnambiz (SJC gold board) · Simplize (env key) | MSN Finance quotes (env instrument map) · Binance PAXGUSDT (vàng) |
| news | CafeF, VnExpress, VietnamBiz, CoinTelegraph RSS | từng feed độc lập; partial-success vẫn được phục vụ kèm note |

## Interface conventions

```ts
interface MarketDataProvider {
  getQuote(symbol): Promise<Quote>;
  getHistory(symbol, ...): Promise<OhlcvBar[]>;
  getSymbols?(): Promise<Symbol[]>;
  getMarketSnapshot?(): Promise<...>;
}
```

Adapter **không trả số suy diễn**. Parse schema linh hoạt (VNStock field aliases), sanity-check giá trị (giá phải hữu hạn, volume ≥ 0), ném `ProviderError` khi payload rỗng/không hợp lệ.

### SSI FastConnect v3 (`src/lib/providers/ssi-fastconnect.ts` + `ssi-trading.ts` + `src/lib/realtime/ssi-fc-stream.ts`)

Tích hợp theo tài liệu chính thức <https://developers.ssi.com.vn/docs/api-reference>.

**REST** — base `https://api.ssi.com.vn` (env `SSI_API_BASE_URL`):

- `POST /api/v3/auth/token` `{apiKey, apiSecret}` → `{accessToken, expiresAt, refreshToken, refreshExpiresAt}`. Token cache tới 60s trước `expiresAt`, single-flight; hết hạn → thử `POST /api/v3/auth/refresh` trước, fallback re-auth; 401/403 → invalidate + retry 1 lần. Market data **không cần OTP**.
- `GET /api/v3/data/securitiesByBoard?board|symbol|index` — security master (tên Vi/En, ICB industry, lotSize, listedShare) → universe + search.
- `GET /api/v3/data/securitiesSummary?symbol&from&to` — tổng hợp giao dịch ngày (close, priceChange/%, OHLC, totalMatch/Value, foreign buy/sell, room) → quotes.
- `GET /api/v3/data/masterdata?from&to` (phân trang) — trần/sàn/tham chiếu toàn thị trường → overlay bands, merge vào quote.
- `GET /api/v3/data/indexList?board` + `GET /api/v3/data/indexSummary?index&tradingDate` — chỉ số (value, change/%, advance/decline). Mã chỉ số chuẩn hóa về canonical của platform (`HNXINDEX→HNX`, `UPCOMINDEX→UPCOM`, …).
- `GET /api/v3/data/ohlc?symbol&from&to&timeFrame` — OHLCV `1d` (toàn bộ lịch sử niêm yết) và intraday `1m/3m/5m/15m/30m/1h` (12 tháng gần nhất), tự phân trang ≤4 trang. Ngày theo `YYYY/MM/DD` (+07), intraday `YYYY/MM/DD HH:mm:ss`.

**WebSocket realtime** — `wss://stream.ssi.com.vn/ws/v3` (env `SSI_STREAMING_URL`), token Bearer từ auth/token (truyền `?access_token=` khi runtime không set được header):

- Subscribe/unsubscribe `{method, channel: DATA|TRADING, topics[]}`; topic convention `trade.<sym>[@1m|5m] · quote.<sym> · room.<sym> · put.<sym> · oddlot.<sym> · market.<board> · order.<accountNo> · portfolio.<accountNo>`; multi-symbol `trade.ACB-SSI-GVR`; whole-board `trade.hose`.
- Heartbeat: server PING → client PONG; engine tự ping mỗi 30s; watchdog 90s im lặng → reconnect.
- Trade tick `{s,t,p,q,a,si,o,h,l,v}` → live quote (change tính theo ref của `market.<board>`/masterdata); quote message → best bid/ask; `market` message → ceiling/floor/ref + cờ phiên (`ATO/LO/ATC…`); chỉ số stream trên cùng topic `trade.VNINDEX…`, change tính theo prevClose seed từ REST indexSummary.
- Reconnect: full-jitter exponential backoff theo lớp lỗi (network/handshake/rate-limit/auth/silent), retry budget 24 → cooldown 5 phút, auth circuit breaker 5 lần; reconnect xong subscribe lại toàn bộ topics.
- Serverless: `SSI_WS_DISABLED=true` → REST-only (nhãn freshness trung thực).

**Trading & FCO** (`ssi-trading.ts`, routes `/api/v1/ssi/*`):

- Truy vấn (token data, không cần OTP): `account/info`, `trading/accountBalance`, `trading/ppmmrAccount`, `trading/position`, `trading/orderBook` (from/to ISO-8601), `trading/maxBuySell`, `trading/fco/list|orderbook|statusHistory`.
- Mutation (đặt/sửa/hủy lệnh + FCO): token cấp **có OTP** (`auth/token` + `otp` hoặc `transactionId` từ `auth/requestOtp` — SmartOTP) + header `X-Signature` = RSA PKCS#1 v1.5 SHA-256 của chính xác JSON body, hex, khóa riêng RSA dạng XML base64 (`SSI_PRIVATE_KEY`). Mở khóa bằng `SSI_TRADING_ENABLED=true`; mọi route trading đều yêu cầu đăng nhập ORCA.
- Trạng thái lệnh map nhãn Vi theo phụ lục order-status-flow (PD/RS/SD/QU/PF/FF/WC/CL/RJ/…).

**Health & ops**: mọi request qua `http.ts` nên `ssi-fastconnect` xuất hiện trong `/api/v1/system/providers`; trạng thái stream tại `/api/v1/system/ssi-ws`; chẩn đoán tổng tại `/api/v1/ssi/status`.

**Bảng giá v3 — hai chế độ theo runtime**: (a) runtime persist (self-host/`next start`) → WS `trade.<board>` cho TOÀN bảng live; (b) serverless/Vercel (`VERCEL=1`) → REST `data/securitiesSummary` (mapPool, concurrency 8) cho ~100 mã thanh khoản cao nhất + `data/indexSummary` cho chỉ số, ghép `data/masterdata` (trần/sàn/tham chiếu) — không phụ thuộc WS, khớp giới hạn function timeout. Sổ lệnh giao dịch (orderBook tài khoản) là REST thuần (`trading/orderBook`) nên hoạt động trên cả hai runtime — chỉ cần login app (+ OTP/private key cho đặt/sửa/hủy).

### SSI FC Data v2 legacy (`src/lib/providers/ssi-fcdata.ts` + `src/lib/realtime/ssi-ws.ts`)

Adapter cũ theo guide.ssi.com.vn (`fc-data.ssi.com.vn/api/v2/Market/*`: AccessToken, DailyStockPrice, DailyOhlc, DailyIndex, Securities, IndexList) + DataHub SignalR (`SwitchChannel` X/B/MI). Giữ nguyên làm fallback khi chưa có key v3.

### VNStock (`src/lib/providers/vnstock.ts`)

Endpoints thử lần lượt (graceful với biến thể base URL): `/v1/market/indices`, `/v1/market/quotes?symbols=`, `/v1/symbols/{sym}/ohlcv`, `/v1/symbols/{sym}/financials/{income|balance|cashflow|ratios}`, `/v1/symbols` (universe). Header: `Authorization: Bearer <key>` + `x-api-key`. Khi không có circuit/recoverable: service trả `null` → API `502 UPSTREAM_UNAVAILABLE` với ghi chú cấu hình.

### Binance (`src/lib/providers/binance.ts`)

- `GET /api/v3/ticker/24hr` — toàn thị trường trong 1 request (cache 12s).
- `GET /api/v3/klines` — OHLCV multi-timeframe (cache 25s).
- `GET /fapi/v1/premiumIndex`, `/fapi/v1/openInterest` — funding/OI (có thể geo-blocked; UI gắn badge `geo-blocked` thay vì ẩn).
- Host failover lưu `lastGood*` giữa các lần gọi.

### Forex (`src/lib/providers/forex.ts` + `services/forex.ts`)

- Biquote: `GET {BIQUOTE_BASE_URL}/v1/quotes?symbols=…` (env, chuẩn hóa nhiều dạng payload).
- Fallback 1: exchangerate-api `/v6/latest/USD` → cross pairs tính toán từ rates USD-based có timestamp provider.
- Fallback 2: Frankfurter `/v1/{start}..{end}?base=…` — chuỗi ECB hằng ngày (đánh nhãn reference, không giả lập intraday).
- % thay đổi đối chiếu **bản fix ECB gần nhất** (1 request, cache 6h).

### Commodities (`src/lib/providers/commodities.ts` + aggregator)

Catalog 12 mặt hàng: metals (XAU, XAG), energy (WTI, Brent, NatGas), industrial (copper, steel), agriculture (coffee, sugar, corn, wheat, soybean), vietnam (SJC).
Nguồn theo ưu tiên từng mã; **mỗi row giữ toàn bộ `sourceRecords`** (multi-source provenance) và map `vnImpact`: commodity → ngành VN → mã liên quan (tham chiếu, không nhân quả).

### News (`src/lib/providers/news.ts`)

Parser RSS tối giản (không dependency): CDATA/entity decoding, validation timestamp (loại tương lai >10p & quá 30 ngày), dedupe sha1(url+title), tag symbol qua từ điển VN-bluechips + crypto keywords, tag sector qua regex tiếng Việt.

## Reliability & rate limits

- Mọi gọi qua `http.ts`: timeout 7–9s, retry ≤2, backoff `400ms·2^n + jitter`, circuit 4 lỗi/60s.
- Rate limit: response 429/5xx tự backoff; cadence cache theo SLA domain (crypto 12s, forex 10m, commodity 5m, news 2m).

## Thêm provider mới

1) Tạo adapter trong `src/lib/providers/<name>.ts` dùng `httpJson/httpText` + `ProviderError`; 2) đăng kỳ domain qua `recordSuccess/Failure` (tự động khi dùng http.ts); 3) thêm fallback vào service tương ứng; 4) health tự xuất hiện ở `/system`.
