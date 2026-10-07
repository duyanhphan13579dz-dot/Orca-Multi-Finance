# ORCA Financial

> **Vietnamese-market-first financial intelligence platform for real market data, deterministic quantitative analysis, and explainable research.**

ORCA Financial là nền tảng phân tích tài chính lấy **thị trường chứng khoán Việt Nam** làm trung tâm. Sản phẩm kết hợp dữ liệu thị trường, BCTC, định giá, kỹ thuật, dòng tiền, tin tức và AI research trong một pipeline có provenance, freshness và trạng thái suy giảm minh bạch.

Crypto, Forex và Commodities là các asset class hỗ trợ dùng chung provider, cache, chart và quantitative engines; chúng không thay thế trọng tâm Vietnam equities của sản phẩm.

## Current main

- Package: `orca-financial@1.0.0`
- Framework: Next.js 16 App Router · React 19 · TypeScript strict
- Main snapshot: `45c9c0b` (sau khi hợp nhất các thay đổi ICT/SMC/VSA, reliability và valuation)
- Các thay đổi gần đây trên `main`: PR #41 (money-flow engine), PR #45 (financial/data reliability), PR #46 (statement-backed valuation inputs)
- Trạng thái: **active development**; chưa phải bản phát hành ổn định có semantic release tag

## What is implemented

### Vietnam equities — product center

- VN stock market dashboard, indices và market snapshot.
- Security/universe search cho HOSE, HNX và UPCoM.
- Quote, OHLCV, reference/ceiling/floor, order book và foreign flow khi nguồn cung cấp.
- Stock detail gồm profile, technical analysis, financial statements, fundamentals, ratios, valuation và AI/company research.
- Screener: fundamental, valuation, CANSLIM, Minervini, candlestick, divergence, Elliott và Wyckoff.
- Sector views, heatmap, breadth, market state và market intelligence.
- Watchlist, portfolio marks, trade journal, alerts, reports và morning brief.

### Valuation và financial intelligence

Pipeline định giá hiện tại gồm:

1. **Phase 1 — market multiples:** P/E, P/B, P/S, EV/EBITDA và các market anchors.
2. **Phase 2 — cash flow, historical và peers:** FCF, FCFF, FCFE, P/FCF, P/CF, EV/FCFF, historical multiples và peer comparison.
3. **Phase 3 — DCF:** Bear/Base/Bull, WACC/Ke, terminal value và sensitivity matrix.
4. **Phase 4 — complementary methods:** residual income, DDM, NAV/SOTP theo mức độ phù hợp của doanh nghiệp.
5. **Phase 5/6 — aggregation và decision layer:** chuẩn hóa fair value, confidence, data quality, risk flags và output phục vụ UI/API.

Các đầu vào dòng tiền được lấy từ dữ liệu báo cáo khi có đủ bằng chứng:

- EBIT và EBITDA TTM.
- Thuế suất từ Tax/PBT.
- D&A từ EBITDA − EBIT khi hợp lệ.
- CAPEX từ cash-flow statement.
- ΔNWC và net borrowing từ các kỳ quý liên tiếp.

Nếu thiếu dữ liệu, phương pháp liên quan trả về `null`/`incomplete`; engine **không tự coi dữ liệu thiếu là zero** và không dựng TTM từ các quý không liên tiếp.

Đơn vị định giá được tách rõ:

- Quote cổ phiếu Việt Nam thường là **nghìn VND**.
- Market cap, enterprise value và financial statement là **VND đầy đủ**.
- Per-share fundamentals là **VND/share**.
- Fair value trả về quote unit để UI hiển thị nhất quán; payload vẫn có `valuationUnits` và `sourceDetails` để audit.

### Technical, flow và multi-asset analysis

- Technical indicators: RSI, MACD, Bollinger Bands, ATR, support/resistance, trend và candlestick patterns.
- Market-state engine: trend, range, accumulation/distribution, breakout/breakdown và evidence.
- ICT/SMC/VSA money-flow engine v2: market structure, BOS/CHOCH, FVG lifecycle, order-block mitigation, OTE, volume/effort-result và CLV/order-flow signals.
- Crypto spot: markets, movers, klines, order book, order flow, funding và open interest khi futures endpoint khả dụng.
- Forex: live quote, OHLC, ECB/Frankfurter reference history và scalp modules.
- Commodities: VietnamBiz goods catalog, normalized units/currency và mapping tác động tham chiếu tới ngành/cổ phiếu Việt Nam.
- News: RSS ingestion, timestamp validation, deduplication, ticker/sector tagging và sentiment.

## Data providers

| Domain | Primary | Fallback / điều kiện |
| --- | --- | --- |
| VN quotes, indices, universe, OHLCV | **VNDirect** | SSI FastConnect nếu có credentials; VPS/Vietcap/Yahoo/Entrade/public feeds tùy endpoint |
| VN financial statements, ratios, equity snapshot | **VNDirect DStock / api-finfo** | VNStock API chỉ bật khi có đồng thời `VNSTOCK_BASE_URL` và `VNSTOCK_API_KEY` |
| Crypto spot | **Binance REST** với host failover | Binance futures cho funding/OI; có thể bị geo-block |
| Forex | Biquote public/configured | exchangerate-api; Frankfurter/ECB cho daily reference history |
| Commodities | **Vietnambiz data portal** | Các adapter/provider phụ trợ tùy symbol và cấu hình |
| News | CafeF, VnExpress, VietnamBiz, Tuổi Trẻ, BBC, CoinTelegraph, Google News, FRED, Fed, ECB, SEC RSS | Từng feed hoạt động độc lập; partial success vẫn được trả kèm metadata |

Provider adapters nằm trong `src/lib/providers/` và financial adapters trong `src/lib/financial/`. Không có mock market data trong request path. Khi upstream lỗi, pipeline thực hiện timeout/retry/backoff, circuit handling, cache và stale-while-revalidate trước khi trả trạng thái `DEGRADED` hoặc `UNAVAILABLE`.

## Reliability và data provenance

Mọi response market-facing mang metadata tương tự:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "source": "vndirect",
    "sourceTimestamp": "2026-10-01T15:00:00.000Z",
    "ingestedAt": "2026-10-01T15:00:02.000Z",
    "freshness": "FRESH",
    "ageMs": 2000,
    "cached": false,
    "stale": false
  }
}
```

Freshness states:

- `LIVE`: dữ liệu streaming/near-real-time trong live SLA.
- `FRESH`: dữ liệu trong freshness SLA.
- `DELAYED`: chậm hơn mục tiêu nhưng còn sử dụng được.
- `STALE`: bản cache gần nhất, được đánh dấu rõ.
- `DEGRADED`: một phần pipeline/provider lỗi.
- `UNAVAILABLE`: không có dữ liệu hợp lệ.

Reliability pipeline dùng HTTP adapter chung (`src/lib/http.ts`), timeout, retry có backoff/jitter, health registry, circuit breaker, TTL cache, request deduplication và stale-while-revalidate. Data quality/reconciliation không trung bình mù các provider; mỗi nguồn được giữ lại trong provenance và discrepancy metadata.

## Architecture

```text
External providers
  ├─ VNDirect / SSI / public VN feeds / VNStock optional
  ├─ Binance
  ├─ Biquote / ECB / exchangerate-api
  ├─ Vietnambiz commodities
  └─ RSS news feeds
          │
          ▼
src/lib/providers + src/lib/financial
  HTTP resilience · normalization · provider health
          │
          ▼
src/lib/cache + src/lib/realtime + src/lib/quality + src/lib/reconcile
  freshness · dedup · stale-SWR · validation · cross-source checks
          │
          ▼
src/lib/engines + src/lib/services
  technical · money-flow · fundamentals · valuation · reports · AI context
          │
          ▼
src/app/api/v1/*
  standardized success/error envelope
          │
          ▼
Next.js App Router UI
  dashboards · stock detail · screeners · reports · portfolio · ops
```

Nguyên tắc kiến trúc:

- React components chỉ gọi internal API; không gọi trực tiếp provider bên ngoài.
- Business logic không gọi `fetch` trực tiếp; dùng HTTP/provider adapters.
- Quant engines tính toán số liệu bằng code; LLM chỉ nhận context đã chuẩn hóa và đã tính.
- API keys chỉ được đọc ở server-side; không đưa secrets xuống browser.
- DB writes là best-effort và không được chặn request path market-critical.

## Main application routes

| Route | Nội dung |
| --- | --- |
| `/` | Market center và snapshot đa tài sản |
| `/stocks` | VN stock universe, search và market board |
| `/stocks/[symbol]` | Stock cockpit: quote, chart, structure, technical, company và flows |
| `/stocks/[symbol]/financials` | BCTC theo kỳ và normalized metrics |
| `/stocks/[symbol]/fundamentals` | Financial health, ratios, growth và risk flags |
| `/stocks/[symbol]/valuation` | Multiples, DCF, sensitivity, fair value và source details |
| `/screener` | Rule-based và quantitative screeners |
| `/market`, `/market/index/[code]`, `/heatmap` | Market breadth, indices, sectors và heatmap |
| `/crypto`, `/crypto/[symbol]` | Crypto markets, charts, flow và scalp analysis |
| `/forex`, `/forex/[symbol]` | FX dashboard, pair detail và scalp analysis |
| `/commodities` | Commodity catalog và Vietnam impact mapping |
| `/news`, `/reports` | News, morning brief và stored research reports |
| `/portfolio`, `/watchlist`, `/journal` | Portfolio marks, watchlist và trade journal |
| `/agent` | Data-first AI research agent |
| `/system`, `/settings` | Provider health, data engine, account và system settings |

## Internal API

Có **99 API route handlers dưới `/api/v1`**. Các endpoint thường dùng:

```text
GET  /api/health
GET  /api/v1/market/snapshot
GET  /api/v1/stocks?symbols=VCB,HPG
GET  /api/v1/stocks/{symbol}
GET  /api/v1/stocks/{symbol}/financials
GET  /api/v1/stocks/{symbol}/fundamentals
GET  /api/v1/stocks/{symbol}/metrics
GET  /api/v1/stocks/{symbol}/ratios
GET  /api/v1/stocks/{symbol}/valuation
GET  /api/v1/stocks/{symbol}/valuation/analyst
GET  /api/v1/crypto/markets
GET  /api/v1/crypto/{symbol}
GET  /api/v1/forex/markets
GET  /api/v1/forex/{PAIR}
GET  /api/v1/commodities
GET  /api/v1/news
GET  /api/v1/reports/morning-brief
POST /api/v1/agent
GET  /api/v1/system/providers
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/auth/me
```

Chi tiết đầy đủ: [`docs/api.md`](docs/api.md).

## Tech stack

- **Runtime:** Node.js `>=20.9.0`
- **Web:** Next.js `16.2.6`, React `19.2.6`, TypeScript `5.9.3`
- **UI:** Tailwind CSS v4, Lucide, lightweight-charts, SWR
- **Data:** PostgreSQL + Drizzle ORM, optional Redis mirror/cache
- **Auth:** scrypt password hashing, JWT HS256 httpOnly cookie, sessions và audit logs
- **AI:** OpenAI-compatible gateway, role-based model cascade, optional local vLLM/LoRA deployment
- **Deployment:** standalone Next build; Vercel config có sẵn, Netlify config có sẵn, container/VPS phù hợp hơn cho process dài hạn/WebSocket

## Getting started

### 1. Requirements

- Node.js `>=20.9.0`
- pnpm
- PostgreSQL cho auth, reports, watchlist và persistence
- Redis là optional; chỉ cần khi bật các flow cần shared cache/pub-sub

### 2. Install

```bash
git clone https://github.com/duyanhphan13579dz-dot/Orca-Multi-Finance.git
cd Orca-Multi-Finance
pnpm install --frozen-lockfile
cp .env.example .env
```

Điền tối thiểu:

```dotenv
DATABASE_URL=postgresql://user:password@localhost:5432/orca
JWT_SECRET=replace-with-a-long-random-secret
```

Các provider keys và base URLs tùy module được liệt kê trong [`.env.example`](.env.example). Secrets chỉ dùng server-side.

### 3. Database

```bash
pnpm exec drizzle-kit push
```

Schema hiện có **23 bảng PostgreSQL** trong [`src/db/schema.ts`](src/db/schema.ts), gồm auth/session, watchlist, stock market/BCTC, crypto, forex, commodities, news, reports, provider health/logs, journal, preferences, alerts và RAG chunks.

### 4. Run locally

```bash
pnpm dev
```

Mở <http://localhost:3000>.

### 5. Production

```bash
pnpm build
pnpm start
```

`next.config.ts` dùng standalone output và giới hạn worker build để phù hợp môi trường memory-constrained. TypeScript build errors hiện được host config bỏ qua để unblock deployment; nên chạy `pnpm typecheck` riêng trong CI/development và xử lý lỗi trước khi phát hành.

## Scripts

```bash
pnpm dev          # Next dev server trên 0.0.0.0:3000
pnpm build        # production build
pnpm start        # start production server
pnpm lint         # ESLint
pnpm typecheck    # tsc --noEmit
pnpm test         # node:test suite cho chart, technical, valuation và pipeline
```

Các test định giá quan trọng:

- `src/lib/__tests__/valuation-pipeline.test.ts`
- `src/lib/__tests__/valuation-phase1.test.ts` đến `valuation-phase6.test.ts`
- `src/lib/__tests__/money-flow.test.ts`

## Deployment notes

### Vercel / serverless

`vercel.json` đã cấu hình framework Next.js và region `sin1`. Các process WebSocket/SSE dài hạn không nên được coi là persistent trên serverless; dùng cache/polling và freshness metadata thay thế.

### Netlify

`netlify.toml` có sẵn. Khi chạy trên Netlify Functions, nên đặt:

```dotenv
BINANCE_WS_DISABLED=true
VNDIRECT_WS_DISABLED=true
SSI_WS_DISABLED=true
```

Serverless instance có vòng đời ngắn; realtime engine sẽ tự fallback về REST/polling. Chỉ bật WebSocket/SSE persistent trên VPS, container hoặc host Node dài hạn.

### Local vLLM / LoRA

Tài liệu deployment AI nằm trong [`deploy/README.md`](deploy/README.md), với script:

```bash
./deploy/vllm_serve.sh
./deploy/test_vllm.sh http://127.0.0.1:8000/v1 orca-analyst-v1
```

AI gateway hỗ trợ `AI_BASE_URL` theo chuẩn OpenAI-compatible và có thể cascade sang backend/model fallback.

## Repository layout

```text
src/app/                 App Router pages và API route handlers
src/components/          UI panels, charts, dashboards và domain components
src/lib/providers/       External provider adapters
src/lib/financial/       Financial normalization, statements, ratios và sources
src/lib/engines/         Technical, money-flow, fundamentals, valuation, screeners
src/lib/services/        Domain orchestration, reports, agents, cache consumers
src/lib/realtime/        WS/SSE, live market pipelines và schedulers
src/db/                  Drizzle schema và database client
docs/                    Architecture, API, providers và feature design notes
deploy/                  vLLM/LoRA deployment helpers
configs/                 AI fine-tuning configuration
public/                  Static assets và service worker
test/                    Test setup và smoke utilities
```

Tài liệu liên quan:

- [`docs/architecture.md`](docs/architecture.md) — layered architecture và reliability pipeline
- [`docs/data-providers.md`](docs/data-providers.md) — provider registry, fallback và conventions
- [`docs/api.md`](docs/api.md) — internal API contracts
- [`docs/smart-portfolio.md`](docs/smart-portfolio.md) — portfolio intelligence
- [`deploy/README.md`](deploy/README.md) — local vLLM/LoRA

## Security và operational rules

- Không commit `.env`, API keys, JWT secret hoặc credentials.
- Không dùng `NEXT_PUBLIC_*` cho provider secrets.
- Validate symbol, pair, limit và query input tại route boundary.
- Không trả internal stack trace ra public API.
- Kiểm tra `GET /api/v1/system/providers`, `/system` và `GET /api/health` khi chẩn đoán upstream/caching.
- Với dữ liệu tài chính, luôn kiểm tra source, report date, freshness, unit và warning trước khi sử dụng.

## Disclaimer

Dữ liệu, tín hiệu và phân tích của ORCA Financial chỉ phục vụ **thông tin, nghiên cứu và giáo dục**, không phải khuyến nghị đầu tư, tư vấn tài chính hay lời mời giao dịch. Người dùng tự chịu trách nhiệm cho mọi quyết định đầu tư.

## License

Proprietary — xem [`LICENSE`](LICENSE). Copyright (c) 2025 Orca Financial. All rights reserved.
