# ORCA Financial

> **A Vietnamese-Stock-Market-First Real-Time Financial Intelligence Platform.**
>
> VIETNAM SECURITIES FIRST — Market → Sector → Stock → Fundamentals → Valuation → Technical → News → AI Equity Research.
> Crypto, Forex và Commodities là các supporting asset classes dùng chung data/chart engine chất lượng cao, nhưng không phải nhân diện sản phẩm.

ORCA Financial được thiết kế xoay quanh thị trường chứng khoán Việt Nam: **Vietnam Security Master** (HOSE/HNX/UPCoM + taxonomy ngành Việt), **Market Session Engine** (ATO → khớp liên tục → nghỉ trưa → ATC với lịch lễ), **reconciliation VNStock⇄VNDirect**, **sector/macro/breadth engines** và **AI Equity Research analyst** — nhận dữ liệu đã calculate từ quant trước khi reasoning.

ORCA Financial kết nối dữ liệu thị trường thật vào một **Centralized Real-Time Data Engine**, xử lý theo hướng event-driven, rồi phân phối tới Market Dashboard, Stock/Crypto/Forex/Commodity modules, News Engine, Reports, Alerts và AI Research Agent — với nguyên tắc tuyệt đối: **không mock data**, mọi dữ liệu đều gắn nguồn + timestamp + trạng thái độ mới.

## Data Sources

| Asset          | Primary Source                    | Fallback (real data)                          |
| -------------- | --------------------------------- | --------------------------------------------- |
| Vietnam Stocks | **SSI FastConnect v3** (`SSI_API_KEY/SECRET`, [developers.ssi.com.vn](https://developers.ssi.com.vn/docs/api-reference)) — REST `api.ssi.com.vn` + WS `stream.ssi.com.vn` | SSI FC Data v2 legacy → VNDirect (no key)     |
| Crypto         | **Binance** REST/WS, host failover| Official Binance public data hosts            |
| Forex          | **Biquote** (API key, env)        | exchangerate-api latest + ECB/Frankfurter     |
| Commodities    | **Vietnambiz** + **Simplize.vn**  | MSN Finance (env map) + Binance PAXG (gold)   |
| News           | RSS multi-feed (CafeF, VnExpress, VietnamBiz, CoinTelegraph) | per-feed failover |

Không có module nào dùng số liệu giả. Khi provider lỗi: **retry → exponential backoff → circuit breaker → cache STALE gần nhất → trạng thái DEGRADED/UNAVAILABLE hiển thị công khai**.

## Features

| Module | Status | Notes |
| --- | --- | --- |
| **Vietnam Security Master** (HOSE/HNX/UPCoM, taxonomy) | Implemented | Symbol→exchange→sector→industry canonical registry + search index |
| **VN Market Session Engine** | Implemented | ATO/liên tục/nghỉ trưa/ATC/post-trading + holidays; freshness theo session |
| **VN Market Center** (dashboard ưu tiên 1) | Implemented | VN indices hero, sector taxonomy, tin VN doanh nghiệp ưu tiên |
| VN Screener (universe tab đầu tiên) | Implemented | Filter theo ngành ±% · GT GD; chiến lược nâng cao roadmap |
| Search VN-first (tên công ty không dấu) | Implemented | Security Master index, VN ticker rank trên mọi asset |
| VN chart reference/ceiling/floor overlays | Implemented | ExtraLevels từ provider khi có dữ liệu |
| VN chart intraday (1m–1h) | Implemented (SSI key) | SSI FastConnect v3 `data/ohlc`; daily/weekly/monthly không cần key |
| Market Dashboard + ORCA Market Pulse | Implemented | Analyst-style narrative từ dữ liệu realtime, gauge risk-appetite |
| Data Quality Engine | Implemented | VALID/SUSPECT/INVALID/STALE, deviation/timestamp/dup checks, anomaly log |
| Reconciliation Engine (VNStock⇄VNDirect) | Implemented | Priority rules + tolerance + discrepancy log, không trung bình provider |
| Centralized Binance WebSocket Engine | Implemented | `!ticker@arr` + `!markPrice@arr` dùng chung; backoff + REST fallback minh bạch |
| LLM Gateway (role-based) | Implemented | reasoning/analysis/classification, env-swappable, không hardcode model |
| Output Validation (anti-hallucination) | Implemented | Numeric-claim tracing → repair/regenerate → deterministic recovery |
| Crypto Scalping Intelligence | Implemented | VWAP/EMA/RSI7/momentum/vol-spike/entry-invalidation, realtime 15s |
| Market-State Engine | Implemented | uptrend/downtrend/sideways/accumulation/distribution/breakout/breakdown + evidence |
| Financial Health Engine | Implemented | profitability/liquidity/leverage/cashflow/efficiency — deterministic |
| Valuation Engine | Implemented | P/E·P/B·EV-based multiples + DCF bear/base/bull với confidence |
| Stock/Forex Analysis Contracts | Implemented | `/stocks/{sym}/analysis`, `/forex/{sym}/analysis` |
| Settings system (8 tabs) | Implemented | Profile→System, persistent local+DB sync |
| Market Ticker realtime | Implemented | CSS marquee, crypto + FX + VN index khi có |
| Crypto (spot, klines, movers, screener) | Implemented | Binance live, multi-host failover |
| Crypto futures (funding, open interest) | Implemented (geo-dependent) | fapi bị chặn theo vùng → trạng thái hiển thị rõ |
| Forex dashboard + pair detail | Implemented | Biquote-ready; fallback rates thật + ECB history |
| Commodities + VN impact mapping | Implemented | Đa nguồn, hiển thị provenance từng record |
| News Engine (RSS, dedupe, tagging) | Implemented | Timestamp validation, symbol/sector tagging |
| Morning Brief (reports) | Implemented | Freshness gate, analyst narrative, lưu DB |
| AI Agent (fetch-data-first) | Implemented | Deterministic engine; LLM optional (bounded context) |
| Technical engine (RSI/MACD/BB/ATR/S-R/patterns) | Implemented | Pure quantitative, deterministic |
| Watchlist + Trade Journal | Implemented | Local-first; server tables sẵn sàng để sync |
| Auth (email/password, scrypt, JWT cookie) | Implemented | `/api/v1/auth/*` |
| Ops/Observability (`/system`) | Implemented | Provider health, latency, circuit, cache stats |
| VN Stocks: universe/quotes/OHLCV/financials | Implemented | SSI FastConnect v3 PRIMARY → SSI v2 → VNDirect fallback |
| **SSI FastConnect v3** (REST + WS realtime + Trading/FCO) | Implemented | `api.ssi.com.vn` REST, `stream.ssi.com.vn` WS, order/FCO signed RSA; key qua env |
| VN Screener / CANSLIM / Minervini / heatmap VN | Planned | Phụ thuộc VNStock reachability |
| WebSocket gateway + Binance WS relay | Planned | REST hiện tại đã realtime ≤15–20s; WS relay nằm trong roadmap `/docs/architecture.md` |
| Google OAuth, 2FA/TOTP | Planned | |
| Valuation engines (DCF/DDM/Graham) VN | Planned | Cần financial statements từ VNStock |

## Architecture

```text
External Providers (SSI FastConnect · VNDirect · Binance · Biquote · Vietnambiz · Simplize · RSS)
        │  timeout / retry / backoff / circuit breaker / health registry
        ▼
Provider Adapter Layer            src/lib/providers/*
        ▼
Domain Services + Engines         src/lib/services/*, src/lib/technical.ts
        │  TTL cache (memory + Redis mirror) · request dedup · stale-while-revalidate
        ▼
Internal REST API  /api/v1/*      standardized envelope { success, data, meta }
        ▼
Frontend (Next.js App Router, client islands, SWR refresh)
        ▼
Reports · AI Agent (structured context) · Ops dashboard
```

Mọi API trả về **standard envelope** với provenance metadata:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "source": "binance",
    "sourceTimestamp": "2026-09-05T02:41:10.000Z",
    "ingestedAt": "…",
    "freshness": "LIVE",
    "ageMs": 830,
    "cached": false,
    "stale": false
  }
}
```

### Data Freshness states

`LIVE` (streaming/near-realtime) · `FRESH` (trong SLA) · `DELAYED` (chậm hơn mục tiêu) · `STALE` (cache hợp lệ cuối cùng) · `DEGRADED` (một phần pipeline lỗi) · `UNAVAILABLE` (không có dữ liệu hợp lệ). UI hiển thị dot + tuổi dữ liệu ở mọi module market-facing; không bao giờ hiển thị LIVE giả.

## Tech Stack

Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind CSS v4 · PostgreSQL + Drizzle ORM · Redis (optional mirror) · lightweight-charts · SWR · jose (JWT) · ioredis.

## Getting Started

```bash
git clone <repository-url>
cd orca-financial
npm install
cp .env.example .env        # điền DATABASE_URL + provider keys
npx drizzle-kit push        # tạo database schema
npm run dev                 # http://localhost:3000
```

Production:

```bash
npm run build
npm run start
```

Checks (chạy trước khi push):

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm test            # chart/quality/freshness engine suite (node:test)
```

### Deployment (Netlify)

`netlify.toml` giữ build command/publish dir và các biến môi trường cần thiết. Hai quy tắc bắt buộc:

1. **Gói cần cho `next build` phải nằm trong `dependencies`** — không phải `devDependencies`. Netlify cài đặt với `NODE_ENV=production`, npm sẽ bỏ qua toàn bộ devDependencies và build chết với `Cannot find module '@tailwindcss/postcss'` (import trace: `src/app/globals.css` → `src/app/layout.tsx`). Vì vậy `tailwindcss`, `@tailwindcss/postcss`, `postcss`, `typescript` và `@types/*` đều nằm trong `dependencies`; `netlify.toml` còn đặt thêm `NPM_FLAGS=--include=dev` làm lớp dự phòng.
2. **`package-lock.json` được commit** để Netlify dùng `npm ci` (tái lập được).

`DATABASE_URL` không còn bắt buộc ở *build time* — client DB khởi tạo lười (`src/db/index.ts`), nên bước "Collecting page data" của `next build` không còn fail khi host không inject DB URL vào môi trường build. Runtime vẫn cần nó cho auth/watchlist/reports.

Trên host serverless (Netlify/Vercel Functions), đặt `BINANCE_WS_DISABLED=true`: instance ngắn hạn không giữ được WebSocket sống, engine sẽ tự chuyển sang REST polling với nhãn freshness trung thực (xem ghi chú trong `netlify.toml`).

Health & diagnostics:

- `GET /api/health` — liveness (DB check)
- `GET /api/v1/system/providers` — provider health, latency, circuit, cache stats
- Trang `/system` — ops dashboard realtime

### Minimum env để chạy (sanity)

Chỉ cần `DATABASE_URL` + `JWT_SECRET`: crypto (Binance, không cần key), forex (fallback thật), gold (PAXG), tin tức RSS sẽ hoạt động ngay. Thêm key để mở đầy đủ module tương ứng (xem bảng Data Sources). API keys **không bao giờ** được đưa xuống browser.

## API Overview

`GET /api/v1/market/snapshot` · `GET /api/v1/stocks?symbols=…` · `GET /api/v1/stocks/{sym}` · `/technical` · `/financials` · `GET /api/v1/crypto/markets` · `GET /api/v1/crypto/{sym}?interval=1h` · `GET /api/v1/forex/markets` · `GET /api/v1/forex/{PAIR}` · `GET /api/v1/commodities` · `GET /api/v1/news?category=&symbol=` · `GET /api/v1/screener?universe=crypto&minChange=&minQuoteVolume=` · `GET /api/v1/reports/morning-brief` · `POST /api/v1/agent {question}` · `GET /api/v1/system/providers` · `POST /api/v1/auth/{register,login,logout}` · `GET /api/v1/auth/me`.

SSI FastConnect (chứng khoán VN): `GET /api/v1/ssi/status` · `GET /api/v1/ssi/account` · `GET/POST/PUT/DELETE /api/v1/ssi/orders` · `POST /api/v1/ssi/otp` · `GET/POST/DELETE /api/v1/ssi/fco` · `GET /api/v1/system/ssi-ws`.

Chi tiết: [`/docs/api.md`](docs/api.md) · Kiến trúc: [`/docs/architecture.md`](docs/architecture.md) · Data providers: [`/docs/data-providers.md`](docs/data-providers.md)

## Repository layout

```text
src/
  app/                    routes (pages) + api/v1 route handlers
  components/             terminal-grade UI (charts, panels, technical views)
  lib/
    providers/            ssi-fastconnect · ssi-trading · vnstock · binance · biquote/forex · commodities · news
    services/             domain engines (crypto, forex, stocks, commodities, news, market, agent, reports)
    realtime/             binance-ws · ssi-ws (legacy) · ssi-fc-stream (FastConnect v3) · candles · scheduler
    cache.ts health.ts http.ts freshness.ts technical.ts auth.ts env.ts
  db/                     drizzle schema (24 tables) + client
docs/                     architecture · data-providers · api
```

## Disclaimer

Dữ liệu và phân tích trong nền tảng chỉ phục vụ mục đích **thông tin và nghiên cứu** — **không phải khuyến nghị đầu tư**. Mọi quyết định giao dịch thuộc trách nhiệm của ngườ dùng.

## License

Proprietary — see [LICENSE](LICENSE). Copyright (c) 2025 Orca Financial. All rights reserved.
