# Báo cáo kỹ thuật — Nâng cấp Forex + Metals Market Data Engine (Multi-source)

> Ngày: 2026-09-06 · Nhánh: `arena/01a07437-orca-multi-finance`
> Phạm vi: **chỉ data providers / engines / backend / API / caching / validation / reliability / testing** — UI/UX hiện tại giữ nguyên (không redesign). Metals là trang MỚI theo đúng visual language hiện có.

---

## 0. Tóm tắt

Hệ thống Forex trước đây phụ thuộc chuỗi `Biquote → Yahoo → exchangerate-api` và
lịch sử **chỉ** là fix tham chiếu ECB flat (o=h=l=c). Lần nâng cấp này:

1. Thêm **Swissquote public BBO** (không key, verified live) làm nguồn DIRECT cho
   FX majors/crosses và toàn bộ kim loại — đây là nguồn realtime thật, có bid/ask/timestamp.
2. Thêm **Vietcombank public API** (không key) + **VietnamBiz Data (WiFeed)**
   cho domain USD/VND riêng: reference / buy cash / buy transfer / sell / free sell.
3. Tạo **Metals domain riêng** XAUUSD/XAGUSD/XPTUSD/XPDUSD là tradable instrument,
   với chart multi-timeframe `1m/5m/15m/30m/1h/4h/1d/1w/1M` và performance 1D/1W/1M/1Q/1Y.
4. Lịch sử Forex/Detail: nâng từ ECB flat → **Yahoo 1d OHLC thật** (fallback ECB),
   performance + technical trên nến thật.
5. Sửa triệt để "Failed to load page": giữ nguyên `normalizeChartPayload`
   (root cause đã ghi trong `src/chart/payload.ts`) + mọi route mới đều partial-safe
   (provider lỗi → UNAVAILABLE/partial, không throw, không 502 HTML).
6. Không mock/không fake OHLC/không realtime giả; market closed **không** được
   coi là provider error (đã xử lý riêng cho VCB/Swissquote/Yahoo cuối tuần).

---

## 1. Provider registry (ưu tiên public/free/direct)

| Provider | Endpoint (public, no key) | Dùng cho | Trạng thái (verified 2026-09-06) |
|---|---|---|---|
| **Swissquote** `swissquote-public` | `forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/{BASE}/{QUOTE}` | FX majors/crosses + metals XAU/XAG/XPT/XPD BBO | ✅ live: EUR/USD 1.1612x, XAU/USD ~4430.6, XPT/USD ~1819, XPD/USD ~1383 |
| **Biquote** `biquote-forex` | `{BIQUOTE_BASE_URL}/v1/quotes` (env) | FX chuyên nghiệp (khi cấu hình) | env-only |
| **Yahoo Finance** `yahoo-fx` | `query1/2.finance.yahoo.com/v8/finance/chart/…` | FX snapshot + OHLC + metals history | public (host failover query1→query2) |
| **exchangerate-api** | `open.er-api.com/v6/latest/USD` | USD-based rates (derive cross) | public |
| **Frankfurter/ECB** | `api.frankfurter.dev/v1/{start}..{end}` | Daily reference + prev-fix % change | public |
| **Vietcombank** `vietcombank-public` | `www.vietcombank.com.vn/api/exchangerates?date=YYYY-MM-DD` | USD/VND cash/transfer/sell | ✅ live 2026-09-04: USD 25,845/25,875/26,255 |
| **VietnamBiz Data (WiFeed)** | `data.vietnambiz.vn/currency-interest-rate` | SBV central rate, NHTM bán, tự do bán; VND override | ✅ live: 25,605 / 26,255 / 25,810 |

Chain FX: **Biquote → Swissquote → Yahoo → ER-API**; mỗi tầng partial-safe (subset vẫn
trả về + `meta.errors`); USDVND luôn bổ sung từ Vietnam FX model khi thiếu.

## 2. Universe pairs

- **Major (7):** EURUSD · GBPUSD · USDJPY · USDCHF · AUDUSD · USDCAD · NZDUSD
- **Cross (8):** EURJPY · EURGBP · GBPJPY · AUDJPY · **EURCHF · EURAUD · GBPCHF · AUDCAD** (mới)
- **Exotic VN (1):** USDVND — model riêng: `reference` 25,605 (SBV) · `buyCash` 25,845 ·
  `buyTransfer` 25,875 · `sell` 26,255 · `freeSell` 25,810 (ngày 04/09/2026)
- **Metals (4):** XAUUSD · XAGUSD · XPTUSD · XPDUSD (tradable instruments, USD/troy ounce)

## 3. Timeframes — trực tiếp vs aggregate

| TF | Forex | Metals | Nguồn | Direct / Aggregate |
|---|---|---|---|---|
| 1m | ✅ | ✅ | Yahoo `1m` range 7d | **direct** |
| 5m | ✅ | ✅ | Yahoo `5m` range 60d | **direct** |
| 15m | ✅ | ✅ | Yahoo `15m` range 60d | **direct** |
| 30m | ✅ | ✅ | Yahoo `30m` range 60d | **direct** |
| 1H | ✅ | ✅ | Yahoo `1h` range 730d | **direct** |
| 4H | ✅ | ✅ | Yahoo `1h` → `aggregateCandles(4h)` | **aggregate** (nến thật, không nội suy) |
| 1D | ✅ | ✅ | Yahoo `1d` (2y–10y) | **direct** |
| 1W | ✅ | ✅ | Yahoo `1wk` range 10y | **direct** |
| 1M | ✅ | ✅ | Yahoo `1mo` range max | **direct** |

Metals history failover spot → futures: `XAUUSD=X→GC=F`, `XAGUSD=X→SI=F`,
`XPTUSD=X→PL=F`, `XPDUSD=X→PA=F`.

## 4. Freshness / market closed

- Mọi response đi qua `buildMeta` → `LIVE/FRESH/DELAYED/STALE/UNAVAILABLE` theo SLA
  provider (FX/metals live 60–120s, fresh 10–30m, delayed 24h; VN FX theo ngày: 12h/48h/96h).
- **Market closed ≠ provider error:** Swissquote/Yahoo cuối tuần trả phiên gần nhất
  (ts cũ) → nhãn DELAYED/STALE + note giải thích; Vietcombank `date=CN` trả
  `UpdatedDate=23:00 T6` → giữ giá phiên gần nhất.
- Realtime Market Store: `metal` đã có trong `StoredAssetType` (STALE 300s / FRESH 150s),
  quote + candles write-through — provider không bị gọi lại khi store còn tươi.

## 5. Root cause "Failed to load page" (giữ nguyên, đã regression-test)

- Root cause đã fix ở `src/chart/payload.ts`: `useApi` trả payload đã unwrap nhưng
  component đọc `data.data.candles` → TypeError trong effect → trang vỡ.
  Fix: `normalizeChartPayload` không throw, trả `null` khi malformed.
- Nâng cấp này **không phá file đó**; regression `src/lib/__tests__/forex-chart-crash.test.ts`
  vẫn pass (#251 suite).
- Mọi route mới: provider lỗi → `unavailable()` 502 JSON (không HTML) hoặc
  `success:true + partial`; service không bao giờ trả null khi còn partial data.

## 6. Files

**Mới:**
- `src/lib/providers/swissquote.ts` — BBO provider (parse venue/profile, chunk 6, partial)
- `src/lib/providers/vietcombank.ts` — tỷ giá VCB (cash/transfer/sell)
- `src/lib/performance.ts` — performance 1D/1W/1M/1Q/1Y (mốc lịch, không nội suy)
- `src/lib/services/vnfx.ts` — domain USD/VND (merge VCB + VietnamBiz, weekend-aware)
- `src/lib/services/metals.ts` — metals domain (catalog, quote multi-source, daily, detail)
- `src/app/api/v1/metals/markets/route.ts`, `src/app/api/v1/metals/[symbol]/route.ts`,
  `src/app/api/v1/vn-fx/route.ts`
- `src/app/metals/page.tsx`, `src/app/metals/[symbol]/page.tsx`,
  `src/components/metals-dashboard.tsx`, `src/components/metals-detail.tsx`
- Tests: `swissquote-provider`, `vnfx`, `performance`, `metals-markets`,
  `metals-partial-detail`, `metals-total-fail`, `forex-swissquote-chain`
- `docs/forex-metals-multi-source-report.md` (file này)

**Sửa:**
- `src/lib/services/forex.ts` — chain Biquote→Swissquote→Yahoo→ER-API, 8 crosses,
  USDVND từ Vietnam FX, detail = Yahoo 1d (fallback ECB) + performance
- `src/lib/services/chart.ts` — `metalCandles` (spot→futures failover, 4h aggregate)
- `src/lib/chart-const.ts` — `ChartAssetType` + `metal`, `METALS_TFS`, `FOREX_TFS` + `1m`
- `src/lib/realtime/market-store.ts`, `src/lib/types.ts` — `metal` (StoredAssetType/AssetClass/MetalRow)
- `src/lib/quality.ts` — DEVIATION_LIMITS `metal: 15`
- `src/app/api/v1/chart/history/route.ts`, `src/app/api/v1/realtime/stream/route.ts` — chấp nhận `metal`
- `src/components/shell.tsx` — nav "Kim loại" (entry mới, không đổi theme)
- `src/components/watchlist-button.tsx`, `src/app/watchlist/page.tsx` — hỗ trợ watchlist metal
- `docs/data-providers.md` — registry mới

## 7. Cache / refresh

| Cache key | TTL | Stale | Ghi chú |
|---|---|---|---|
| `forex:swissquote:{n}` | 30s | 12h | BBO direct |
| `metals:swissquote` | 30s | 12h | BBO metals |
| `metals:yahoo-quotes` | 60s | 24h | change/prevClose reference |
| `forex:yahoo:{n}` | 30s | 12h | FX snapshot |
| `forex:er-latest` | 10m | 26h | ER-API |
| `forex:prev-rates` | 6h | 72h | ECB prev fix |
| `vnfx:model` | 30m | 48h | VCB + VietnamBiz (đổi theo ngày) |
| `vnb-data:currency-interest-rate` | 6h (env) | 48h | WiFeed refresh 00:00 hằng ngày |
| Chart series (`chart:…`) | 18–60s | 24h | + Realtime Market Store write-through |

## 8. Test / build

- `npm run typecheck` — PASS
- `npm test` — **251/251 pass** (trước: 231; +20 test mới: swissquote 4, vnfx 6, performance 4, metals 3, forex chain 2, …)
- `npm run lint` — **0 errors** (18 warnings pre-existing, không thuộc file mới)
- `npm run build` — PASS (`/metals` static, `/metals/[symbol]` dynamic, `/api/v1/vn-fx`, `/api/v1/metals/*`)

## 9. Acceptance checklist (26 mục)

| # | Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|---|
| 1 | Multi-source, không dependency provider đơn | ✅ | Chain 4 nguồn FX + 2 nguồn VN FX + 2 nguồn metals |
| 2 | Ưu tiên public/free/direct | ✅ | Swissquote, VCB, Yahoo, ER-API, Frankfurter, WiFeed (đều no-key) |
| 3 | 7 cặp major | ✅ | PAIRS `major` = 7 |
| 4 | Cross FX | ✅ | 8 crosses (4 cũ + 4 mới) |
| 5 | Vietnam FX model riêng USD/VND | ✅ | `vnfx.ts`: reference/buyCash/buyTransfer/sell/freeSell + API `/api/v1/vn-fx` |
| 6 | Metals domain riêng XAUUSD/XAGUSD/XPT/XPD | ✅ | `metals.ts`, catalog 4, UI `/metals` |
| 7 | Metals = tradable instrument | ✅ | assetClass `metal`, quote BBO bid/ask/unit, watchlist, chart đầy đủ |
| 8 | Multi-TF 1m cho XAUUSD/XAGUSD | ✅ | Yahoo 1m (7d) |
| 9 | Multi-TF 5m/15m | ✅ | direct |
| 10 | Multi-TF 1H | ✅ | direct |
| 11 | Multi-TF 4H | ✅ | aggregate từ 1h (nến thật) |
| 12 | Multi-TF 1D/1W/1M | ✅ | direct |
| 13 | Historical (daily) | ✅ | Yahoo 1d OHLC thật (2y) + failover futures |
| 14 | Performance 1D | ✅ | `performance.ts` |
| 15 | Performance 1W | ✅ | ✅ |
| 16 | Performance 1M | ✅ | ✅ |
| 17 | Performance 1Q | ✅ | ✅ |
| 18 | Performance 1Y | ✅ | ✅ |
| 19 | Không mock/fake OHLC | ✅ | Mọi nến từ provider; rác → dropped + log; thiếu → UNAVAILABLE |
| 20 | Không fake realtime | ✅ | Timestamp provider; SLA trung thực; không "live" với dữ liệu cũ |
| 21 | Market closed ≠ provider error | ✅ | Note + freshness (Swissquote/Yahoo/VCB) |
| 22 | Fix triệt để "Failed to load page" | ✅ | `normalizeChartPayload` giữ nguyên + regression test |
| 23 | Provider lỗi không crash page | ✅ | partial-safe + `unavailable()` JSON 502; test total-fail/partial |
| 24 | Giữ nguyên UI/UX hiện tại | ✅ | Forex pages không đổi; watchlist/shell chỉ thêm entry additive |
| 25 | Cache/refresh minh bạch | ✅ | Bảng §7 + `meta.cached/stale/source` |
| 26 | Báo cáo kỹ thuật + test/build | ✅ | File này; 251/251 pass, typecheck/lint/build PASS |
