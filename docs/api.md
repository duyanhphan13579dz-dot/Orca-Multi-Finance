# Internal API — `/api/v1/*`

Envelope chuẩn cho mọi endpoint:

```json
// success
{ "success": true, "data": {}, "meta": { "source": "binance", "sourceTimestamp": "…", "ingestedAt": "…", "freshness": "LIVE", "ageMs": 830, "cached": false, "stale": false } }
// failure
{ "success": false, "error": { "code": "UPSTREAM_UNAVAILABLE", "message": "…" }, "meta": { "freshness": "UNAVAILABLE", … } }
```

## Market

| Endpoint | Mô tả | Nguồn |
| --- | --- | --- |
| `GET /api/v1/market/snapshot` | Snapshot tổng hợp: indices, crypto top+summary, forex, commodities, news, **pulse** + freshness per-section | engine |
| `GET /api/v1/market/intel` | Command center payload: độ rộng, thanh khoản, flow, cross-asset, market-condition score, đóng góp chỉ số | engine |
| `GET /api/v1/market/index/{code}` | Chi tiết chỉ số (VNINDEX/VN30/HNXINDEX…) + áp lực mua/bán + cấu phần | engine |

### Cú pháp chung

- Query params dùng `camelCase` (`minChange`, `minQuoteVolume`…); giá trị không hợp lệ → `badRequest`.
- Mọi endpoint trả envelope; khi nguồn dữ liệu không khả dụng → `UPSTREAM_UNAVAILABLE` (HTTP 502) + `meta.freshness = "UNAVAILABLE"`.
- `GET /api/v1/chart/stream` là SSE (`text/event-stream`); client phải xử lý heartbeat + reconnect.

## Stocks (VN)

| Endpoint | Mô tả | Nguồn |
| --- | --- | --- |
| `GET /api/v1/stocks?symbols=VCB,HPG` | Board VN: indices + quotes (UPSTREAM_UNAVAILABLE khi thiếu key) | VNStock |
| `GET /api/v1/stocks/{symbol}` | Quote + OHLCV 250 + technical + patterns + financials | VNStock |
| `GET /api/v1/stocks/{symbol}/technical` | OHLCV + full indicator snapshot | VNStock |
| `GET /api/v1/stocks/{symbol}/financials` | income/balance/ratios theo quý | VNStock |
| `GET /api/v1/stocks/{symbol}/analysis` | Structured contract: market-state + financial-health + valuation + news, kèm confidence | engine |
| `GET /api/v1/reports/stock/{symbol}` | Stock Report analyst-style (FACT/CALCULATION/INTERPRETATION/SCENARIO) | engine |

## Crypto

| Endpoint | Mô tả | Nguồn |
| --- | --- | --- |
| `GET /api/v1/crypto/markets?limit=&sort=gainers|losers|volume` | Toàn thị trường USDT spot + summary/breadth | Binance |
| `GET /api/v1/crypto/{symbol}?interval=15m|1h|4h|1d` | Ticker + klines + technical + patterns + funding/OI | Binance |
| `GET /api/v1/crypto/{symbol}/scalp?tf=1m|5m|15m` | Scalp signal (VWAP/EMA/RSI7/vol-spike/entry-invalidation) | Binance |

## Forex

| Endpoint | Mô tả | Nguồn |
| --- | --- | --- |
| `GET /api/v1/forex/markets` | 12 cặp major/minor/exotic + note sức mạnh USD | Biquote/fallback |
| `GET /api/v1/forex/{PAIR}` | Giá hiện tại + chuỗi ECB 12 tháng + technical | Biquote/ECB |
| `GET /api/v1/forex/{PAIR}/analysis` | Structured contract: market-state + technical + risk metrics | engine |

## Chart (unified)

| Endpoint | Mô tả | Nguồn |
| --- | --- | --- |
| `GET /api/v1/chart/history?symbol=&assetType=&timeframe=&limit=` | Candles chuẩn hóa + indicators (EMA20/50, BB, VWAP, RSI, MACD, S/R) + markers | engine |

> **Phase 2 — Data Reliability (backward-compatible additions):** các endpoint VN (indices/quotes/ohlcv/detail) trả thêm
> `meta.dataConfidence` `{ score, level: high|medium|low|unverified, factors[] }` (đa nguồn khớp → high; 1 nguồn tối đa medium;
> fallback/dữ liệu cũ → low) và `meta.providers` (danh sách nguồn tham gia). Không field nào bị đổi/đi — UI không cần sửa.
| `GET /api/v1/chart/stream?symbol=&assetType=&timeframe=` | SSE live: `snapshot` / `chart.candle.updated` / `chart.candle.closed` / heartbeat | WS engine |

## Realtime (Phase 1)

| Endpoint | Mô tả | Nguồn |
| --- | --- | --- |
| `GET /api/v1/realtime/stream?topic=market&symbols=BTCUSDT,VNM&assetType=crypto\|stock\|all` | SSE realtime thống nhất multi-asset. Events: `snapshot` / `quote` / `index` / heartbeat. `symbols` trống → tất cả quote đang có trong store | Market Store |
| `GET /api/v1/realtime/stream?topic=watchlist` | **Auth bắt buộc** — quote realtime cho watchlist của user (+ khởi động VN engine cho cổ phiếu) | watchlist + Market Store |
| `GET /api/v1/realtime/stream?topic=alerts` | **Auth bắt buộc** — đánh giá alert `price_above/below` + `pct_change` ngay trên từng quote; `alert` event khi trigger + persist `triggeredAt`. RSI/volume_spike đánh giá qua scheduler 5 phút | alerts engine |
| `GET /api/v1/realtime/stream?topic=candle&symbol=BTCUSDT&assetType=crypto&timeframes=5m,15m,1h,1d` | SSE candle đa timeframe: `snapshot` (history + current) / `candle` / `candle.closed`. Crypto: base 1m từ Binance kline WS + seed REST per TF. VN: 1m live từ engine, 1d seed OHLCV REST | Multi-TF Candle Engine |

Event payload là envelope đã unwrap (payload giữ nguyên contract cũ của đường chart).
Mọi topic đều có `snapshot` đầu tiên, heartbeat 20s, reconnect do client tự xử lý.

## Commodities / News / Screener

| Endpoint | Mô tả | Nguồn |
| --- | --- | --- |
| `GET /api/v1/commodities` | Catalog + rows đa nguồn + unavailable list + impact mapping | multi |
| `GET /api/v1/news?category=&symbol=&sector=&limit=` | Tin tức đã dedupe/tag/validate timestamp | RSS multi-feed |
| `GET /api/v1/screener?universe=crypto\|vn&minChange=&maxChange=&minQuoteVolume=&exchange=&sector=&limit=&sort=` | Screener rule-based. `vn` cần VNSTOCK_API_KEY; hỗ trợ lọc exchange/sector/symbols | Binance / VNStock |

## Market Intelligence (Phase 3 — backend-enabled, UI chưa hiển thị)

| Endpoint | Mô tả | Nguồn |
| --- | --- | --- |
| `GET /api/v1/market/breadth` | Độ rộng VN: advancers/decliners, advance ratio, up/down volume, % trên SMA20/50, new highs/lows 20 phiên, score 0..100 | engine |
| `GET /api/v1/market/sectors` | Xoay vòng ngành: median % đổi, participation, volume share, RS, rotation score, top/laggard, dispersion | engine |
| `GET /api/v1/market/state` | Regime thị trường VN (bull/recovery/sideways/correction/bear/unknown) + risk appetite + volatility ratio + evidence | engine |
| `GET /api/v1/market/leaders?limit=20` | Cổ phiếu dẫn dắt/đuôi (score RS+momentum+volume), limit 1..50 | engine |
| `GET /api/v1/market/smart-alerts` | 8 quy tắc thị trường (breadth thrust, volume surge, rotation trigger, cụm mã mạnh…) kèm severity + lý do | engine |
| `GET /api/v1/market/events?limit=20` | Sự kiện phát hiện từ dữ liệu (dedupe 5 phút, ring 100) — scheduler chạy 5 phút | engine |

## Alerts

| Endpoint | Mô tả | Nguồn |
| --- | --- | --- |
| `GET /api/v1/alerts` | Danh sách alert đang active của user (401 nếu chưa login) | engine |
| `POST /api/v1/alerts` `{assetType,symbol,condition,threshold}` | Tạo alert: `condition ∈ price_above\|price_below\|pct_change\|rsi\|volume_spike` | engine |
| `PATCH /api/v1/alerts/{id}` `{active?,threshold?}` | Bật/tắt hoặc đổi ngưỡng (đổi ngưỡng reset `triggeredAt`) | engine |
| `DELETE /api/v1/alerts/{id}` | Xóa alert | engine |
| `POST /api/v1/alerts/check` | Đánh giá thủ công toàn bộ alert của user (scheduler poll 5 phút tự chạy) | engine |

## Watchlist

| Endpoint | Mô tả | Nguồn |
| --- | --- | --- |
| `GET /api/v1/watchlist` | Danh sách watchlist server-side của user | DB |
| `PUT /api/v1/watchlist` `{items:[{assetType,symbol}]}` | Replace toàn bộ (local-first: UI sync fire-and-forget khi login) | DB |

## Reports & AI

| Endpoint | Mô tả | Nguồn |
| --- | --- | --- |
| `GET /api/v1/reports?type=&limit=` | Lịch sử bản tin (DB-persisted) | engine |
| `POST /api/v1/reports` `{type}` | Tạo ngay morning_brief / market_summary / strategy | engine |
| `GET /api/v1/reports/morning-brief` | Morning Brief analyst-style (freshness gate) | engine |
| `GET /api/v1/reports/{id}` | Chi tiết bản tin đã lưu | engine |
| `POST /api/v1/agent` `{question}` | AI Agent: intent → fetch data → answer + meta | engine (+LLM opt.) |

## Ops / Auth / Settings

| Endpoint | Mô tả | Nguồn |
| --- | --- | --- |
| `GET /api/health` | Liveness (DB check `select 1`) | ops |
| `GET /api/v1/system/providers` | Provider health, circuit, latency, cache stats, WS state | ops |
| `GET /api/v1/system/info` | Version, uptime, DB/Redis, feature flags | ops |
| `POST /api/v1/auth/register` `{email,password,name?}` | Đăng ký (scrypt; JWT cookie) | auth |
| `POST /api/v1/auth/login` `{email,password}` | Đăng nhập | auth |
| `POST /api/v1/auth/logout` | Xóa phiên | auth |
| `GET /api/v1/auth/me` | Thông tin user hiện tại (401 nếu chưa login) | auth |
| `PATCH /api/v1/auth/profile` | Cập nhật profile (xem qua `/auth/me`) | auth |
| `POST /api/v1/auth/password` | Đổi mật khẩu | auth |
| `GET /api/v1/auth/sessions` / `DELETE` | Liệt kê / thu hồi phiên | auth |
| `GET /api/v1/auth/activity` | Audit log hoạt động | auth |
| `GET/PUT /api/v1/settings` | Đồng bộ settings người dùng (DB) | settings |
