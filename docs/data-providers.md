# Data Providers

Mọi provider phía sau **Provider Adapter Interface** và bị metadata health giám sát:
`provider · status · last_success · last_failure · latency (last/EMA) · circuit · recent events`.

Catalog chuẩn (id khớp provider id runtime) nằm ở `src/lib/data-engine/catalog.ts` và được
phơi ra tại `GET /api/v1/system/connectivity` (probe thật từng nguồn) + `/system/providers`.

## Registry (priority)

| Domain | Primary | Fallbacks |
| --- | --- | --- |
| Market data cổ phiếu VN (quotes/board) | VNDirect (snapshot toàn board + per-symbol) | VPS `getliststockdata` · SSI iBoard · Vietcap · SSI FastConnect (nếu cấu hình) |
| OHLCV cổ phiếu/chỉ số VN | VNDirect `stock_prices`/`vnmarket_prices` | VNDirect dchart (host khác) · Entrade · VPS TradingView history · Yahoo `.VN`/`^VNINDEX` · SSI FastConnect (nếu cấu hình) |
| Universe niêm yết | VNDirect `/v4/stocks` (+ recent listings) | SSI iBoard HOSE/HNX/UPCoM · `LIQUID_BOARD` fallback (đánh dấu partial) |
| BCTC cổ phiếu VN | VNDirect DStock / api-finfo | VNStock API khi có cả `VNSTOCK_BASE_URL` và `VNSTOCK_API_KEY` |
| Hồ sơ/ratios doanh nghiệp | VNDirect `/v4/company_profiles`, `/v4/ratios`, `/v4/shareholders` | — |
| crypto | Binance spot REST (`api.binance.com` → `api{1,2}.binance.com` → `data-api.binance.vision`) | CoinGecko (public/proxy) khi Binance bất khả dụng; Binance fapi cho futures (geo-dependent) |
| forex | Biquote (env) · Biquote public OHLC | exchangerate-api open latest; Frankfurter/ECB daily history + previous fix; Yahoo `=X` |
| commodities | Vietnambiz data portal | Yahoo futures enrichment (GC=F, CL=F…); Simplize/MSN khi có env |
| news | CafeF, VnExpress, VietnamBiz, CoinTelegraph RSS | từng feed độc lập; partial-success vẫn được phục vụ kèm note |
| phái sinh / lãi suất | HNX derivatives | VSDC specs & margin schedule |

## Đường đi dữ liệu market/stock (đã nối)

1. **Toàn board 1 lần gọi**: `getVndMarketSnapshot()` (`providers/vndirect-market-quotes.ts`) lấy cả
   HOSE/HNX/UPCoM qua `/v4/stock_prices?size=500&page=N` (page 1 trước, các page sau song song 4),
   dừng sớm khi đã phủ đủ danh sách yêu cầu, cache 8s trong phiên / 45s ngoài phiên.
   Multi-quote dùng snapshot khi request ≥ 20 mã, per-symbol khi ít hơn.
2. **Quote race**: `multi-quote.ts` tier 1 ∥ VNDirect + VPS + SSI iBoard → tier 2 ∥ Vietcap + public-vn
   khi coverage < 75% (`MULTI_SOURCE_MODE=aggressive` để luôn chạy tier 2). Conflict giá được đếm
   (`1.5%` hoặc `200đ`) và ghi vào meta, không trung bình provider.
3. **OHLCV race**: `stocks-board.getVnOhlcv` ∥ VNDirect api-finfo · VNDirect dchart · Entrade · VPS-hist ·
   Yahoo (`.VN`, `^VNINDEX`…) · SSI FastConnect nếu có credentials — chọn chuỗi ≥ 20 nến rồi dài nhất,
   cache `vn:ohlcv:{sym}:{limit}` 60s/stale 30m. Nguồn thắng được ghi vào `market-source-monitor`.
4. **Chart timeframe**: `vnStockChartPlan()` route 1m/5m/15m/30m/1h → dchart native, 4h → tổng hợp từ 1h,
   1w/1M/12M → tổng hợp từ daily, 1d → daily race (trước đây mọi timeframe đều trả nến daily).
5. **Universe**: `services/vn-universe.ts` gộp VNDirect `/v4/stocks` (LISTED + recent) với SSI iBoard,
   cache 6h/stale 36h; `getVnUniverseList()` dùng nó trước khi hạ xuống board quotes/LIQUID_BOARD.
6. **Board toàn thị trường**: `GET /api/v1/stocks?universe=all[&exchange=HOSE&limit=]` phục vụ cả
   danh sách niêm yết từ cache board (`vn-market-board:v3`).

## Self-test kết nối

- `GET /api/v1/system/connectivity` — probe song song mọi nguồn trong catalog (public GET rẻ, timeout
  mặc định 2.5s), trả `status=ok|fail|circuit_open|not_configured`, latency, `routes[domain]` (thứ tự
  fallback theo health + latency) và danh sách nguồn công khai chưa nối adapter.
- `?force=1` bỏ cache 20s; `?timeout=5000` nới budget probe.
- Nguồn cần env (`VNSTOCK_BASE_URL`+`VNSTOCK_API_KEY`, `POLYGON_API_KEY`, `BIQUOTE_BASE_URL`,
  `DERIVATIVES_QUOTE_URL`) được đánh `not_configured` thay vì báo lỗi sai.
- UI: panel “Kiểm tra kết nối nguồn dữ liệu” trong `/system`.

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

### VNDirect financial adapters (`src/lib/financial/vndirect-http.ts`)

BCTC, ratios, equity snapshot và company profile dùng chung một HTTP adapter có timeout/retry và luân phiên host `api-finfo.vndirect.com.vn` → `finfo-api.vndirect.com.vn`. Có thể cấu hình `VNDIRECT_FALLBACK_BASE_URLS` (phân tách bằng dấu phẩy/chấm phẩy); khi đặt `VNDIRECT_BASE_URL` riêng thì adapter tôn trọng base đó, không tự gửi request sang host công khai nếu chưa cấu hình fallback.

### VNStock (`src/lib/providers/vnstock.ts`)

Endpoints hỗ trợ `/v1/market/indices`, `/v1/market/quotes?symbols=`, `/v1/symbols/{sym}/ohlcv`, `/v1/symbols/{sym}/financials/{income|balance|cashflow|ratios}`, `/v1/symbols` (universe). Header: `Authorization: Bearer <key>` + `x-api-key`. Financial provider thứ cấp chỉ bật khi có **cả** `VNSTOCK_BASE_URL` và `VNSTOCK_API_KEY`; dữ liệu được chuẩn hóa theo period/metric, không phát sinh fallback số khi thiếu field.

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
