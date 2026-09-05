# Data Providers

Mọi provider phía sau **Provider Adapter Interface** và bị metadata health giám sát:
`provider · status · last_success · last_failure · latency (last/EMA) · circuit · recent events`.

## Registry (priority)

| Domain | Primary | Fallbacks |
| --- | --- | --- |
| stocks (VN) | VNStock (env: `VNSTOCK_BASE_URL`, `VNSTOCK_API_KEY`) | — (UNAVAILABLE nếu chưa cấu hình) |
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
