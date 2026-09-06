# ORCA Financial — Architecture

## 0. ORCA UI/UX STABILITY RULE (bắt buộc — 2026-09)

```
UI Appearance        = STABLE
UI Components        = PRESERVE
API Contracts        = BACKWARD COMPATIBLE
Backend              = EVOLVE
Data Engine          = UPGRADE
Realtime Capability  = EXPAND
```

**Nguyên tắc:** giao diện (appearance) và components là **contract đã chốt với người dùng**.
Mọi roadmap mặc định được hiểu là:

> **BACKEND / DATA / REALTIME / INTELLIGENCE UPGRADE ONLY — KEEP CURRENT UI/UX APPEARANCE.**

### Quy tắc thực thi (review gate)

1. **Không sửa UI trừ khi task chủ động yêu cầu.** Các thay đổi bị cấm mặc định: `src/app/**/page.tsx`, `src/components/**`, `src/chart/**` (client logic), `src/hooks/**`, CSS/theme, layout, sidebar, bảng điều khiển, màu/typography/spacing — kể cả "tinh chỉnh nhỏ".
2. **API contracts backward compatible:** không đổi tên/ý nghĩa field, không xoá field, không đổi ngữ nghĩa status code/event name của endpoint đã công bố. Cần thêm dữ liệu → **thêm field mới** (optional) hoặc **thêm endpoint mới** (`/api/v1/...`); payload SSE giữ nguyên cấu trúc cũ (unwrap envelope nếu engine nội bộ đổi).
3. **Backend/Data/Realtime/Intelligence = tự do tiến hoá** trong lớp `src/lib/**` (services, engined, providers, realtime) và route API — miễn không phá mục (1)-(2).
4. Nếu một task **bắt buộc** đụng UI, agent phải yêu cầu người dùng xác nhận trước khi viết code UI; nếu không có xác nhận → chỉ làm backend và mô tả thay đổi UI cần thiết (không thực thi).
5. Kiểm chứng mỗi PR: diff không chứa file UI ngoài phần được duyệt; CI (lint/typecheck/test/build) xanh.

### Rà soát tuân thủ (Phase 1 realtime core — commit a0075dd)

- ✅ Không chạm `src/components`, `src/chart`, `src/hooks`, `.tsx`, CSS.
- ✅ API: chỉ **thêm** `/api/v1/realtime/stream`; các endpoint cũ giữ nguyên; SSE chart stream **giữ nguyên payload** cho client (unwrap envelope phía server).
- ✅ Backend/Data/Realtime: tiến hoá đúng phạm vi cho phép.

## 1. Layered design

```text
Frontend (React/Next.js, client islands + SWR)
  ↓  — chỉ gọi API nội bộ
Internal API             src/app/api/v1/*
  ↓  — standard envelope { success, data, meta }
Domain Services          src/lib/services/*
  ↓  — business logic, cache, freshness, compositional intelligence
Provider Adapters        src/lib/providers/*
  ↓  — timeout, retry, backoff, circuit breaker, health registry
External Sources         VNStock · Binance · Biquote · Vietnambiz · Simplize · RSS
```

- **Không** logic provider nào xuất hiện trong React component.
- **Không** frontend nào gọi trực tiếp provider bên ngoài.
- Business logic không import `fetch` trực tiếp — luôn qua `src/lib/http.ts` để có resilience thống nhất.

## 2. Reliability pipeline (mỗi lờ gọi provider)

1. Circuit check (`health.ts`) — 4 lỗi liên tiếp → mở circuit 60s (half-open).
2. `fetch` + AbortController timeout (7–9s).
3. Retry tối đa 2 lần, exponential backoff + jitter, tôn trọng `Retry-After`.
4. Ghi nhận health (latency EMA, success/failure, event ring) → persist `provider_health`.
5. Kết quả đi qua TTL cache (`cache.ts`): fresh window + **stale-while-revalidate** window; producer fail → phục vụ bản gần nhất với cờ `stale` → meta đánh dấu `STALE` minh bạch.
6. Request deduplication: cùng key chỉ có một producer chạy (chống thundering herd khi nhiều user mở cùng trang).

## 3. Data freshness model

Mỗi response meta: `source`, `sourceTimestamp`, `ingestedAt`, `freshness`, `ageMs`, `cached`, `stale`, `latencyMs`, `note`, `sections` (cho snapshot tổng hợp).

| Trạng thái | Ý nghĩa | Ui |
| --- | --- | --- |
| LIVE | pipeline realtime, age trong live SLA | dot xanh có pulse |
| FRESH | trong freshness SLA | dot xanh |
| DELAYED | chậm hơn mục tiêu | dot vàng |
| STALE | cache gần nhất, không có bản mới | dot vàng mờ |
| DEGRADED | một phần provider lỗi | dot đỏ mờ |
| UNAVAILABLE | không có dữ liệu hợp lệ | dot đỏ |

SLA per-domain định nghĩa trong service tương ứng (crypto 30s/120s/600s, forex 1h/6h/30h, ECB history 1d/2d/5d, news 10m/1h/6h…).

## 4. Modules → event flow

```text
crypto.price.updated (Binance 24h ticker, 12s cadence)
  → markets table, movers, heatmap, screener, watchlist, pulse, agent, reports
stock.quote.updated (VNStock, khi được cấu hình)
  → indices header, board, heatmap VN, technical incremental
forex/commodity/news.updated
  → dashboards, pulse narrative, morning brief freshness gate
```

Hiện tại distribution dùng **polling thông minh phía client** (SWR refresh theo SLA của từng domain) + server cache. Roadmap: **internal WebSocket gateway** với event bus Redis pub/sub khi bật `REDIS_URL`, relay từ Binance WS, delta updates cho heatmap/watchlist (xem §7).

## 5. Central market snapshot

`src/lib/services/market.ts#buildMarketSnapshot` là **single aggregation point**: một lờ gọi song song (allSettled) tới từng domain service, hợp nhất freshness `sections`, tính **Market Pulse**:

- Điểm risk-appetite trong [-1, +1] từ: biến động trung bình crypto thị trường (w×0.55), độ rộng advancers/decliners (w×0.2), chỉ số VN khi có (w×0.3), clamp.
- Narrative analyst-style được dựng từ template có **số liệu thật** — không câu chữ cảm tính, không nhãn "NEUTRAL-BALANCED".
- Snapshot cache 10s — toàn bộ dashboard/ticker/AI dùng chung, tránh gọi provider theo component.

## 6. Database (Drizzle/PostgreSQL)

22 bảng: auth (users/sessions/audit_logs), watchlists(+items), stock (symbols/quotes/ohlcv/financial_statements), crypto (symbols/quotes/futures_metrics), forex_quotes, commodity_quotes, news, reports, market_snapshots, provider_health, provider_logs, trade_journal, user_preferences, alerts. Tracer fields cho financial data: `source`, `source_timestamp`, `ingested_at`, `period_year/quarter`, `report_type`.

Ghi DB ở chế độ **best-effort, fire-and-forget** (không bao giờ chặn request path): provider health upsert, news dedupe insert, commodity canonical records, reports archive.

## 7. Intelligence pipeline (v2 — implemented)

```text
DATA PROVIDERS
  ↓ (VNStock⇄VNDirect reconciliation · Binance WS+REST · Biquote/fallback · multi-source commodities · RSS)
VALIDATION + NORMALIZATION        src/lib/http.ts, providers/*
  ↓
DATA QUALITY ENGINE               src/lib/quality.ts  (VALID/SUSPECT/INVALID/STALE + logged anomalies, dedupe, ordering, deviation, timestamp)
  ↓
RECONCILIATION ENGINE             src/lib/reconcile.ts (priority rules, tolerance, discrepancy log — never averages providers)
  ↓
REALTIME STORE / CACHE            src/lib/realtime/binance-ws.ts (centralized !ticker@arr + !markPrice@arr) + src/lib/cache.ts
  ↓
QUANT ENGINES                     technical.ts · engines/market-state.ts · engines/scalp.ts · engines/fundamental.ts · engines/valuation.ts
  ↓
MARKET INTELLIGENCE LAYER         services/intelligence.ts (LLM DATA CONTRACT builders + confidence)
  ↓
LLM GATEWAY                       ai/gateway.ts (roles: reasoning/analysis/classification — env-swappable models)
  ↓
OUTPUT VALIDATION                 ai/validate.ts (numeric-claim tracing, repair/regenerate, deterministic recovery)
  ↓
REPORTS · AI AGENT · SCALP SIGNAL · FOREX/STOCK ANALYSIS → UI via /api/v1/* only
```

Data contract per analysis: `{asset, market_data, technical_state, market_state, fundamental_state, risk_metrics, news_context, data_meta{source,freshness,fetched_at}}` — the LLM never receives unvalidated raw data, never does arithmetic the quant engines own (`CALCULATE WITH CODE → REASON WITH LLM`), and every answer ships with `confidence`, `dataQuality`, `dataFreshness` and (when LLM-assisted) an `outputValidation` audit.

## 8. Roadmap → full event-driven realtime

**PHASE 1 — REALTIME CORE (implemented 2026-09-06):**

1. **Unified Event Model** — `src/lib/realtime/event-envelope.ts`: mọi event chạy qua `RealtimeEvent` (id `channel:seq`, ts, assetType, symbol, payload) + `channels.ts` (channel registry). Redis pub/sub bridge tùy chọn (`REDIS_URL`): publish `orca:rt`, subscribe lại + dedupe bằng seen-set — multi-instance fanout không echo. Bus cũ giữ `onAny` cho store/gateway; consumer cũ an toàn qua `payloadOf()`.
2. **Realtime Market Store** — `src/lib/realtime/market-store.ts`: một store thống nhất cho stock/crypto/forex/commodity/index; `setQuote` validate bằng Data Quality (INVALID bị reject + log), TTL/freshness theo asset class, subscripton dedupe, auto-ingest tick events (không ghi đè quote phong phú của engine VN), snapshot/getMany.
3. **Multi-TF Candle Engine** — `src/lib/realtime/multi-tf-candles.ts`: base 1m → resample mọi TF (5m/15m/1h/1d…); merge seed REST + live (contribution map theo baseOpen, fast-path O(1) khi bar hiện tại không phải extreme, rebuild khi cần); crypto kline WS + VN 1m frames; `seedTf` seed thẳng bucket đích (VN 1d). Emits `candle.updated`/`candle.closed` chỉ khi có subscriber.
4. **Incremental Technical Engine** — `src/lib/engines/technical-incremental.ts`: stateful O(1)/tick (SMA window, EMA SMA-seeded, Wilder RSI, MACD(12,26,9), Bollinger σ population, ATR last-N); test đối chiếu full-recompute `technical.ts` tại từng bước (sai số 1e-6).
5. **SSE Gateway** — `src/app/api/v1/realtime/stream/route.ts`: topic `market` (quote multi-asset + index events) / `watchlist` (auth) / `alerts` (auth, evaluate-on-quote + persist) / `candle` (multi-TF + REST seed). Redis fanout qua event model. Chart stream cũ vẫn giữ contract payload cũ (unwrap envelope).
6. **VN Market Data Engine** — `src/lib/realtime/vn-market-engine.ts`: session-aware cadence (10s continuous, 15s ATO, 30s ATC/post, 60s pre-open/lunch, dừng + final poll sau close), single-flight, VNStock→VNDirect fallback, ghi store + emit `tick`/`vn.index`, 1m base frame → multi-TF.

Còn lại roadmap: WS nâng cấp từ SSE, delta JSON patches, incremental chạy trực tiếp trên kline của store (đã có engine sẵn sàng), VN universe scheduler.

## 9. Data Reliability (Phase 2)

**Nguyên tắc:** UI giữ nguyên (ORCA UI/UX Stability Rule §0) — mọi thay đổi nằm ở lớp dữ liệu: dữ liệu hiển thị đáng tin cậy hơn, ít lỗi hơn, tự khôi phục tốt hơn.

1. **Vietnam Multi-Provider Data Engine** — `src/lib/engines/vn-data-engine.ts`: N provider (VNStock primary, VNDirect secondary), adapter DI (test với fake), health-aware routing (circuit-open bị loại khỏi vòng gọi), telemetry `recordSuccess/recordFailure` per adapter.
2. **Provider fallback** — quotes: chạy song song các provider sống → reconcile; OHLCV: fallback tuần tự VNStock → VNDirect → **archive**; indices: VNStock → null (UNAVAILABLE) → cache stale giữ bản cuối.
3. **Reconciliation** — tái dùng `reconcile.ts` (không lấy trung bình): quality → freshness → priority; discrepancy > 0.8% ghi `providerLogs` + expose `meta.discrepancies`.
4. **Data Confidence** — `src/lib/confidence.ts`: điểm 0..1 + level (high ≥.85 / medium ≥.55 / low ≥.30 / unverified): agreement đa nguồn (+.30 max), quality (+.30), freshness theo SLA phiên (+.20), provider health (+.20), fallback penalty (−.15). **1 nguồn tối đa .80 → không bao giờ high khi chưa đối chiếu chéo.** `meta.dataConfidence` (thêm mới, backward-compatible).
5. **Market session awareness** — `vnSlasForSession()` trong `vn/sessions.ts`: trading 30s/3m/10m · pre-open+lunch 60m/2h/18h · ngoài phiên 18h/24h/7d → SLA động theo trạng thái phiên (trước đây hardcode); confidence dùng `vnValidSlaMs()` (3m phiên / 1h nghỉ / 18h ngoài).
6. **Data freshness** — `freshness.ts` giữ nguyên model LIVE/FRESH/DELAYED/STALE/DEGRADED/UNAVAILABLE; meta.note minh bạch khi fallback/degraded.
7. **Async Historical Archive** — `src/lib/services/archive.ts` dùng bảng `stock_quotes` (PK symbol+ts, dedupe phút) + `stock_ohlcv` (PK symbol+date): quote snapshot mỗi phút từ VN engine (best-effort, không chặn request), nến ngày qua scheduler sau 15:02 giờ VN (1 lần/ngày, idempotent); đọc archive làm **fallback OHLCV khi provider offline**.

Ràng buộc API: chỉ **thêm** field `meta.dataConfidence`/`meta.providers` — schema response cũ giữ nguyên, UI không đổi.

## 10. Market Intelligence (Phase 3)

**Nguyên tắc:** triển khai **ẩn phía sau UI hiện tại**. 6 engine backend + 6 endpoint mới; nếu sau này cần hiển thị → **chỉ bổ sung dữ liệu vào component hiện có, không redesign trang** (§0 vẫn áp dụng).

| Module | Engine (pure) | Endpoint mới | Ý nghĩa |
| --- | --- | --- | --- |
| Market Breadth | `engines/breadth.ts` | `GET /api/v1/market/breadth` | advancers/decliners, advance ratio, up/down volume, % trên SMA20/50, new highs/lows 20 phiên (chỉ khi có OHLCV), score 0..100 |
| Sector Rotation | `engines/sector-rotation.ts` | `GET /api/v1/market/sectors` | median %thay đổi theo ngành (chống outlier), participation, volume share, RS vs thị trường, rotation score + top/laggard + dispersion |
| Market State (regime) | `engines/market-regime.ts` | `GET /api/v1/market/state` | regime bull_trend/recovery/sideways/correction/bear_trend/unknown, risk appetite 0..100, vol ratio 30/120 phiên, evidence[] có lý do |
| Leadership | `engines/leadership.ts` | `GET /api/v1/market/leaders?limit=` | score 0..100 = RS (40) + momentum (30) + volume share (30); leaders/laggards |
| Smart Alerts | `engines/smart-alerts.ts` | `GET /api/v1/market/smart-alerts` | 8 quy tắc cấp thị trường (breadth thrust/capitulation, volume surge, breakout/breakdown, rotation trigger, cụm mã mạnh, new highs, vol expansion) — có severity + lý do |
| Event Intelligence | `engines/event-intelligence.ts` | `GET /api/v1/market/events` | sự kiện phát hiện từ dữ liệu (index move, sector move, khối lượng, kỷ lục 20 phiên, cụm ngành) — dedupe 5 phút, ring 100 events, scheduler chạy 5 phút |

Nguồn dữ liệu: quotes thật (VN_SECURITIES ≤135 mã, chunk 30), OHLCV top-30 mã thanh khoản (độ sâu breadth), VNINDEX OHLCV (tolerant). Không bao giờ suy diễn khi thiếu dữ liệu — fields null + note.
Không đổi bất kỳ payload endpoint/UI hiện có; tất cả là endpoint mới + engine mới.

## 11. Security

- API keys chỉ đọc qua `src/lib/env.ts` (module `server-only`), không biến `NEXT_PUBLIC_*`.
- Auth: scrypt password hash, JWT HS256 trong httpOnly cookie (`/api/v1/auth/*`), audit logs.
- **Rate limiting** (`src/lib/rate-limit.ts`): login 10 lần/IP+email và 40/IP trong 15 phút; register 10/IP/giờ → HTTP 429 `TOO_MANY_REQUESTS`.
- **Production guard** (`assertSecureEnv`): từ chối 503 khi `JWT_SECRET` thiếu hoặc <32 ký tự trong `NODE_ENV=production` (fallback dev bị chặn).
- **Security headers** (`next.config.ts`): X-Content-Type-Options, Referrer-Policy, Permissions-Policy, HSTS (production).
- Input validation ở mọi route (symbol regex, cặp FX 6 ký tự, giới hạn length/limit).
- Không trả internal stack trace: error envelope `{ code, message }` ngắn gọn.
