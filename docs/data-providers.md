# Data Providers

Mọi provider phía sau **Provider Adapter Interface** và bị metadata health giám sát:
`provider · status · last_success · last_failure · latency (last/EMA) · circuit · recent events`.

## Registry (priority)

| Domain | Primary | Fallbacks |
| --- | --- | --- |
| stocks (VN) | **VNDirect finfo** (keyless public; env override `VNDIRECT_BASE_URL`) | archive lịch sử tự lưu (OHLCV); ngoài ra UNAVAILABLE minh bạch |
| crypto | Binance spot REST (`api.binance.com` → `api{1,2}.binance.com` → `data-api.binance.vision`) | Binance fapi cho futures (geo-dependent) |
| forex | Biquote (env) | Yahoo Finance (FX snapshot + OHLC chart, public no-key); exchangerate-api open latest; Frankfurter/ECB daily history + previous fix |
| commodities | Vietnambiz (SJC gold board) · Simplize (env key) | MSN Finance quotes (env instrument map) · Yahoo Finance (public futures quotes) · Binance PAXGUSDT (vàng) |
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

Adapter **không trả số suy diễn**. Parse schema linh hoạt (VNDirect field aliases), sanity-check giá trị (giá phải hữu hạn, volume ≥ 0), ném `ProviderError` khi payload rỗng/không hợp lệ.

### VNDirect (`src/lib/providers/vndirect.ts`) — Vietnam Stock Data Provider CHÍNH

| Nhóm dữ liệu | Endpoint (finfo REST) | Chuẩn hoá |
| --- | --- | --- |
| Market indices (A) | `GET /v4/indices` (snapshot) · `GET /v4/index_prices` (history) | `IndexQuote` {code,value,change,changePercent,volume,updatedAt} + `OhlcvBar[]` |
| Stock quotes (B) | `GET /v4/stock_latest?q=code:A,B` | `Quote` + reference/ceiling/floor + top-of-book bid/ask + sourceTs |
| OHLCV/chart (C) | `GET /v4/stock_prices` (daily) | `OhlcvBar[]`; 1W/1M aggregate deterministic; intraday 1m/5m/15m/30m/1h từ Realtime Multi-TF engine (live) |
| Financial statements (D) | `GET /v3/stocks/financialStatement?secCodes=…&reportTypes=QUARTER|YEAR&modelTypes=…` (modelTypes 1/89/101/411 income · 2/90/102/412 balance · 3/91/103/413 cashflow) | pivot rows {period,year,quarter,itemName…} + canonical keys |
| Financial ratios (E) | `GET /v4/ratios?q=code:…` (itemName/itemCode) + deterministic engine | `vn-ratio-engine.ts` (P/E, P/B, ROE, ROA, margins, D/E, current/quick, EPS, BVPS, EBITDA/Assets, EBITDA/Interest, FCF/EBIT) |
| Order book (F) | top-of-book từ `stock_latest` (bid/ask 1) | `{symbol,timestamp,bids,asks,spread,…}`; depth → `UNAVAILABLE` (không suy diễn) |
| Recommendations (G) | — VNDirect finfo không công bố | `{status:"UNAVAILABLE", reason}` — tuyệt đối không fake |

Không còn khái niệm primary/secondary/reconciliation: một source duy nhất + `archive` tự lưu cho OHLCV. Khi provider offline → `null`/`UNAVAILABLE` + cache stale giữ bản cuối; `http.ts` xử lý timeout/rate-limit/circuit.

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

### Commodities (`src/lib/providers/commodities.ts` + `engines/commodity.ts` + `services/commodities.ts`)

**Universe chính thức (30 mục, mỗi mục có Group/Sub-group/Market/Currency/Unit):**
- 🟡 Precious metals: Vàng SJC, Vàng thế giới, Bạc
- 🔩 Industrial: Đồng, Nickel, Quặng sắt, Thép HRC, Thép D10
- ⚡ Energy: WTI, Khí thiên nhiên, Than cốc, Xăng RON95, Xăng RON92, Diesel
- 🌾 Grains: Ngô, Đậu nành, Gạo
- ☕ Soft: Cà phê Arabica, Cà phê Robusta, Cao su TSR20, Cao su RSS3, Bông, Đường
- 🧪 Fertilizers: URE
- 🐄 Livestock & Dairy: Heo hơi VN, Heo hơi TQ, Sữa bột nguyên kem, Sữa bột tách béo
- 🦐 Seafood: Tôm thẻ, Cá tra

Mọi mục chính thức đều có **trang Simplize công khai** (verified `simplize.vn/hang-hoa` 2026-09-06:
`gia-thep-d10`, `gia-xang-ron95/ron92`, `gia-dau-diesel`, `gia-heo-hoi-mien-bac`,
`gia-tom-the`, `gia-ca-tra-vietnam`, `gia-ca-phe-robusta`, `gia-cao-su-tsr20/rss3`,
`gia-sua-bot-nguyen-kem-nguyen-lieu`, `gia-sua-bot-tach-beo-nguyen-lieu`,
`gia-heo-hoi-trung-quoc`…). Đơn vị/tiền tệ đọc từ trang (`Nghìn đồng/kg` → VND,
`CNY/kg` → CNY, `JPY/kg` → JPY — xem `currencyForUnit`).

**UNAVAILABLE diagnostics:** service giữ `unavailable[].reason` theo từng nguồn
(ví dụ `simplize: http_404`, `simplize: circuit_open:simplize`, `yahoo: …`) +
`errors[]` tổng hợp để API/UI giải thích đúng lý do — không bao giờ giả nguồn.
Một provider lỗi (kể cả circuit breaker) chỉ làm mục đó UNAVAILABLE, không làm
crash cả trang.

**Ưu tiên nguồn (user-mandated): Simplize → Vietnambiz → Yahoo → MSN → Binance (PAXG).**
- Simplize: trang công khai SSR `simplize.vn/hang-hoa/{slug}` (verified 200; gold = `/gia-vang/the-gioi`,
  SJC = `/gia-vang/pnj/vang-mieng-sjc-9999-pnj`); parse giá/change/changePercent/prevClose/open/day-range/
  unit/perf 7D/1M/3M/YTD/1Y/5Y/related-stocks — **không có API JSON công khai** (đã verify 404) nên KHÔNG
  dùng `def.key` làm ticker, không ép endpoints không tồn tại. Brent/wheat/aluminum/zinc/cacao → 404 đã verify
  → không có `simplizePath` (honest UNAVAILABLE hoặc fallback).
- Vietnambiz: board SJC (mua/bán) — chỉ dùng cho `sjc-gold`.
- Yahoo: futures quote + chart OHLC (CL=F, NG=F, BZ=F, HG=F, GC=F… — cùng ticker mà chart Simplize tự nhúng,
  verified `simplize.vn/chart?ticker=CL=F`); chart history mọi mặt hàng có `yahooSymbol`; thiếu OHLC → `CLOSE_ONLY`,
  không bịa OHLC.
- MSN/Binance chỉ fallback khi hai nguồn ưu tiên không khả dụng.

**Unified model (additive, không phá UI contract):** mỗi `CommodityRow` giữ `sourceRecords`, `id/name/nameVi/
category/subcategory/previousClose/open/high/low/freshness/marketState/freshnessNote/priceType/performance
{"1D".."1Y"}/relatedStocks/sourceUrl/sourceTimestamp`. Freshness per row (FRESH/DELAYED/STALE/UNAVAILABLE)
theo timestamp nguồn — nguồn không công bố timestamp → DELAYED (không bao giờ fake LIVE). Quote được
`validateQuote` (assetClass commodity, stale 300s) trước khi lưu; INVALID → UNAVAILABLE, không lưu rác.

Service: `getCommodityMarket/History/Performance/Impact/Detail/News/Correlation` + write-through
`marketStore.setQuote` (assetType `commodity`) + persist best-effort vào bảng `commodity_quotes`.
Bounded concurrency 6 khi scrape catalog (~37 trang, không hammer nguồn).

**Intelligence profile (mỗi commodity):**
- Performance 1D/1W/1M/1Q/1Y: tính từ lịch sử thật (nearest valid observation); nếu thiếu → provider
  perf do nguồn công bố (`basis: "provider"`); không đủ cả hai → `insufficient` (không bịa số).
- Impact matrix (`/impact`): per-stock `relationshipType/direction/impactStrength/confidence/channel`
  từ mapping cơ chế ngành (curated + evidence) cho economic-exposure rows; related-source rows giữ
  CONDITIONAL/LOW. Correlation KHÔNG dùng làm bằng chứng nhân quả.
- Correlation/Sensitivity (`/correlation` trong detail): `computeSensitivity` (engine thuần) — align
  theo ngày UTC, r (Pearson) + β (statistical) với VNINDEX, ≥30 quan sát; thiếu lịch sử →
  `INSUFFICIENT_DATA` (VN commodity chỉ giá hiện tại, không có chuỗi công khai).
- News & Catalysts (`/news` trong detail): lọc RSS thật theo từ khóa commodity (mới nhất trước,
  timestamp từ feed — không hiển thị tin cũ như catalyst mới); catalysts = news-driven markers.

### News (`src/lib/providers/news.ts`)

Parser RSS tối giản (không dependency): CDATA/entity decoding, validation timestamp (loại tương lai >10p & quá 30 ngày), dedupe sha1(url+title), tag symbol qua từ điển VN-bluechips + crypto keywords, tag sector qua regex tiếng Việt.

## Reliability & rate limits

- Mọi gọi qua `http.ts`: timeout 7–9s, retry ≤2, backoff `400ms·2^n + jitter`, circuit 4 lỗi/60s.
- Rate limit: response 429/5xx tự backoff; cadence cache theo SLA domain (crypto 12s, forex 10m, commodity 5m, news 2m).

## Thêm provider mới

1) Tạo adapter trong `src/lib/providers/<name>.ts` dùng `httpJson/httpText` + `ProviderError`; 2) đăng kỳ domain qua `recordSuccess/Failure` (tự động khi dùng http.ts); 3) thêm fallback vào service tương ứng; 4) health tự xuất hiện ở `/system`.
