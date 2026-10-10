<div align="center">
  <img src="public/icon.svg" width="96" height="96" alt="ORCA Multi-Finance Logo" />
  <h1>ORCA Multi-Finance</h1>
  <p><strong>Vietnamese-Market-First Financial Intelligence Platform</strong></p>
  <p>Real-Time Market Data · Deterministic Quantitative Models · Resilient Multi-Source Engine · Cloudflare Workers</p>

  <p>
    <img src="https://img.shields.io/badge/Next.js-16.3.8-black?style=flat-square&logo=next.js" alt="Next.js" />
    <img src="https://img.shields.io/badge/React-19.2.6-blue?style=flat-square&logo=react" alt="React" />
    <img src="https://img.shields.io/badge/TypeScript-5.9.3-blue?style=flat-square&logo=typescript" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Platform-Cloudflare_Workers-orange?style=flat-square&logo=cloudflare" alt="Cloudflare Workers" />
    <img src="https://img.shields.io/badge/Tests-140%2F140_PASS-brightgreen?style=flat-square" alt="Tests 140/140 Pass" />
    <img src="https://img.shields.io/badge/TypeScript_Errors-0-brightgreen?style=flat-square" alt="TypeScript 0 Errors" />
  </p>
</div>

---

## 📌 Giới thiệu

**ORCA Multi-Finance** (`orca-financial`) là nền tảng phân tích tài chính thông minh lấy **thị trường chứng khoán Việt Nam (HOSE, HNX, UPCoM)** làm trọng tâm cốt lõi. Nền tảng kết hợp dữ liệu thị trường trực tiếp, Báo cáo tài chính (BCTC), định giá nội tại nhiều tầng, phân tích kỹ thuật theo cấu trúc dòng tiền lớn (ICT/SMC/VSA), tin tức và AI Research trong một kiến trúc Serverless có nguồn gốc dữ liệu minh bạch (provenance), quản trị độ tươi mới chặt chẽ (freshness SLA) và cơ chế tự phục hồi lỗi (resilient fallback).

Các lớp tài sản toàn cầu như **Crypto, Forex, Hàng hóa (Commodities)** và **Kinh tế vĩ mô** được tích hợp đồng bộ nhằm phản ánh mối tương quan đa chiều với thị trường tài chính Việt Nam.

---

## 🏆 Lộ trình nâng cấp toàn diện (6 Phase System Upgrade)

Hệ thống đã hoàn tất trọn vẹn lộ trình 6 Phase tái cấu trúc và tối ưu hóa hạ tầng Serverless Cloudflare Workers:

| Phase | Trọng tâm & Thành tựu | Trạng thái |
| :--- | :--- | :---: |
| **Phase 1** | **Kiểm toán Toàn diện & Tài liệu Kiến trúc**: Rà soát type safety, dọn dẹp import/biến thừa; hoàn thiện tài liệu kiến trúc đa tầng, sơ đồ dòng dữ liệu và ma trận nhà cung cấp (VNDirect, SSI, Vietcap, Vietstock, TCBS, CoinGecko, Binance, Yahoo Finance). | ✅ Hoàn thành |
| **Phase 2** | **Khắc phục Lỗ hổng P1–P3 & Chuẩn hóa CI**: Xử lý triệt để các lỗi logic định giá P/E, P/B, EV/EBITDA, DCF; chặn suy diễn CAPEX = 0; tích hợp cơ chế bảo vệ ngân sách Workers qua `workers-guard.ts`. | ✅ Hoàn thành |
| **Phase 3** | **Data Hub Chuẩn hóa, Freshness SLA & Reconcile Engine**: Thiết lập 4 cấp SLA độ tươi mới (`LIVE`, `FRESH`, `DELAYED`, `STALE`); triển khai Động cơ đối soát dữ liệu đa nguồn (`reconcile.ts`) với điểm tín nhiệm (confidence scoring) và telemetry theo dõi lỗi provider. | ✅ Hoàn thành |
| **Phase 4** | **Chuẩn hóa 7 Trạng thái UI Data State**: Đồng bộ 7 trạng thái hiển thị (`IDLE`, `LOADING`, `SUCCESS`, `PARTIAL_DEGRADED`, `STALE_CACHED`, `EMPTY`, `ERROR`) trên 10 module và trang trọng điểm (Stock Detail, BCTC, Valuation, DCF, Forecast, Order Book, News, AI Panel, Technical, Commodities). | ✅ Hoàn thành |
| **Phase 5** | **Zero Horizontal Overflow & Tối ưu Mobile Viewport**: Triệt tiêu tràn màn hình ngang từ 320px đến 1440px+; loại bỏ độ trễ 300ms tap delay bằng `touch-action: manipulation`; chuẩn hóa kích thước vùng chạm ngón tay cái WCAG 2.5.5 (≥ 44px). | ✅ Hoàn thành |
| **Phase 6** | **Kiểm thử Tích hợp Toàn diện, Resilient Fallback & Bảo mật**: Tự động kích hoạt Fallback/Cache có cờ cảnh báo khi nhà cung cấp upstream gặp sự cố (500/timeout); chuẩn hóa phong bì lỗi 502 với `unavailableNote`; xác thực bảo mật Cron với `CRON_SECRET`. Đạt **140/140 tests pass**. | ✅ Hoàn thành |

---

## ⚡ Các tính năng cốt lõi

### 1. Thị trường Chứng khoán Việt Nam (Vietnam Equities)
- **Market Cockpit & Universe Search:** Theo dõi chỉ số VN-Index, VN30, HNX-Index, UPCoM; bảng giá realtime, độ rộng thị trường (market breadth), bản đồ nhiệt (heatmap), dòng tiền khối ngoại.
- **Chi tiết cổ phiếu chuyên sâu:** Biểu đồ tương tác TradingView lightweight-charts, hồ sơ doanh nghiệp, cơ cấu cổ đông, lịch sử sự kiện & cổ tức.
- **Sổ lệnh Khớp lệnh (Order Book):** Độ sâu thị trường trực quan với visual depth bar và cảnh báo độ tươi mới.
- **Screener đa phương pháp:** Bộ lọc cơ bản, định giá, CANSLIM, Minervini Trend Template, Candlestick patterns, Phân kỳ kỹ thuật (RSI/MACD Divergence), Elliott Wave và Wyckoff.

### 2. Định giá & Phân tích Tài chính Xác định (Deterministic Valuation Engine)
Pipeline định giá 6 bước dựa trên dữ liệu báo cáo tài chính thực chứng, **không bịa đặt số liệu thiếu**:
1. **Market Multiples:** P/E, P/B, P/S, EV/EBITDA chuẩn hóa theo ngành.
2. **Dòng tiền & Lịch sử:** FCFF, FCFE, P/FCF, EV/FCFF; so sánh trung vị lịch sử 3 năm và nhóm doanh nghiệp cùng ngành (peers).
3. **Mô hình DCF:** Kịch bản Thận trọng / Cơ sở / Khả quan (Bear/Base/Bull), ma trận độ nhạy WACC và Tốc độ tăng trưởng vĩnh viễn (Terminal Growth).
4. **Mô hình Bổ trợ:** Thu nhập thặng dư (Residual Income), Chiết khấu cổ tức (DDM), Định giá từng phần (SOTP/NAV).
5. **Trọng số ngành & Dải độ tin cậy:** Trọng số tùy biến theo đặc thù tài chính (Ngân hàng ưu tiên Residual Income/PB; Bất động sản ưu tiên NAV; Doanh nghiệp sản xuất ưu tiên DCF/EV-EBITDA).
6. **Tổng hợp Fair Value & Minh bạch Dữ liệu:** Đưa ra định giá mục tiêu, tỷ lệ Upside/Downside, điểm định giá (0–100) và thuyết minh rõ ràng các chỉ số bị thiếu.

### 3. Phân tích Dòng tiền Thông minh (ICT / SMC / VSA Engine v2)
- Nhận diện cấu trúc thị trường: BOS (Break of Structure), CHOCH (Change of Character).
- Vùng thanh khoản: FVG (Fair Value Gap), Vùng mất cân bằng (Imbalance), Khối lệnh (Order Block mitigation).
- VSA (Volume Spread Analysis): Đánh giá tương quan giữa khối lượng và biên độ nến (Effort vs Result), phát hiện tích lũy và phân phối.

### 4. Đa tài sản, Vĩ mô & Tài chính Cá nhân
- **Crypto Spot:** Bảng giá top 250 cặp USDT có thanh khoản cao nhất, Klines, Order flow, funding rate.
- **Forex & Commodities:** Tỷ giá ngân hàng trung ương (ECB/Frankfurter), danh mục hàng hóa thiết yếu cập nhật từ VietnamBiz mapping tác động trực tiếp tới các ngành kinh tế Việt Nam.
- **Tài chính cá nhân & Danh mục:** Quản trị danh mục đầu tư, nhật ký giao dịch (Trade Journal), kế hoạch tài chính cá nhân.
- **AI Financial Research Agent:** Tích hợp mô hình AI phân tích chuyên sâu với bối cảnh tài chính chuẩn hóa, hỗ trợ cascade failover giữa các nhà cung cấp LLM.

---

## 🏛️ Kiến trúc Hệ thống (System Architecture)

```text
External Data Providers
  ├─ VNDirect / SSI FastConnect / Public Feeds
  ├─ Binance REST (Top 250 USDT Liquid Pairs)
  ├─ Biquote / ECB / Frankfurter Forex Feeds
  ├─ VietnamBiz Commodities Catalog
  └─ Multi-Source Financial News Feeds
          │
          ▼
src/lib/providers/ & src/lib/financial/
  Normalization · Workers Budget Guard · Fallback Retries
          │
          ▼
Data Hub: Freshness SLA & Reconcile Engine
  SLA Tracking (LIVE/FRESH/DELAYED/STALE) · Multi-Source Cross-Check · Confidence Scoring
          │
          ▼
Quantitative & Valuation Engines
  Multiples · DCF · Residual Income · ICT/SMC/VSA · Market State · AI Synthesis
          │
          ▼
Standardized API Envelope (/api/v1/*)
  HTTP 200/502/401 Envelopes · Stale/Fallback Headers · unavailableNote
          │
          ▼
Next.js App Router UI (Zero-Overflow & Touch Optimized)
  7 UI Data States · Responsive 320px–1440px+ · Lightweight Charts
```

---

## 📊 Ma trận Nhà cung cấp Dữ liệu (Data Providers)

| Phân hệ | Nguồn chính | Nguồn phụ / Cơ chế Fallback |
| :--- | :--- | :--- |
| **Giá cổ phiếu, Chỉ số, Lệnh VN** | **VNDirect** | SSI FastConnect (khi có credentials), Vietcap, Yahoo Finance, Cache Fallback |
| **Báo cáo tài chính & Chỉ số cơ bản** | **VNDirect DStock / api-finfo** | Vietstock, TCBS, VNStock API |
| **Crypto Spot & Phái sinh** | **Binance REST** | Failover sang host phụ; lọc top 250 cặp USDT thanh khoản lớn nhất |
| **Forex** | **Biquote REST** | ExchangeRate API, ECB/Frankfurter cho dữ liệu lịch sử |
| **Hàng hóa (Commodities)** | **VietnamBiz Portal** | Bộ nhớ đệm tự phục hồi fallback |
| **Tin tức & Sự kiện** | **RSS Multi-Feeds** (CafeF, VnExpress, VietnamBiz, v.v.) | Thu thập đa kênh độc lập, khử trùng lặp và phân loại mã cổ phiếu |

---

## 🛠️ Công nghệ Sử dụng (Tech Stack)

- **Framework:** Next.js 16.3.8 (App Router, Turbopack, Standalone Output)
- **Thư viện UI:** React 19.2.6, Tailwind CSS v4, Lucide React, TradingView lightweight-charts, SWR
- **Ngôn ngữ:** TypeScript 5.9.3 (Strict Mode, 0 compile errors)
- **Cơ sở dữ liệu:** PostgreSQL 16 + Drizzle ORM (23 bảng quan hệ); Upstash Redis (bộ nhớ đệm mở rộng)
- **Hạ tầng triển khai:** Cloudflare Workers (thông qua adapter `@opennextjs/cloudflare` và `wrangler.jsonc`)
- **Bảo mật:** Scrypt password hashing, JWT HS256 httpOnly cookie, xác thực Cron Secret

---

## 🚀 Hướng dẫn Cài đặt & Phát triển Cục bộ

### 1. Yêu cầu hệ thống
- **Node.js:** `>= 20.9.0` (khuyên dùng Node 22+)
- **Quản lý gói:** `pnpm` hoặc `npm`
- **PostgreSQL:** Dùng cho Auth, Watchlist, Báo cáo và Lưu trữ người dùng

### 2. Cài đặt mã nguồn

```bash
# Clone kho lưu trữ
git clone https://github.com/duyanhphan13579dz-dot/Orca-Multi-Finance.git
cd Orca-Multi-Finance

# Cài đặt dependencies
pnpm install --frozen-lockfile

# Cấu hình biến môi trường
cp .env.example .env
```

Cấu hình các biến bắt buộc tối thiểu trong file `.env`:
```dotenv
DATABASE_URL=postgresql://user:password@localhost:5432/orca
JWT_SECRET=your-random-strong-secret-key-at-least-32-chars
CRON_SECRET=your-cron-authentication-token
```

### 3. Đồng bộ Cơ sở dữ liệu

```bash
pnpm exec drizzle-kit push
```

### 4. Khởi chạy ứng dụng

```bash
pnpm dev
# Truy cập giao diện tại http://localhost:3000
```

---

## 🧪 Kiểm thử & Xác thực Mã nguồn (Testing & Verification)

Dự án áp dụng quy chuẩn kiểm thử nghiêm ngặt trước mỗi lần phát hành:

```bash
# Chạy toàn bộ 140 Unit & Integration Tests
pnpm test

# Kiểm tra tính toàn vẹn kiểu dữ liệu TypeScript (0 errors)
pnpm typecheck

# Kiểm tra định dạng và quy chuẩn mã nguồn
pnpm lint

# Kiểm tra build sản phẩm Next.js
pnpm build
```

---

## ☁️ Triển khai Sản xuất (Cloudflare Workers Deployment)

Dự án đã được cấu hình tối ưu hóa hoàn toàn cho Cloudflare Workers thông qua `@opennextjs/cloudflare`:

### Triển khai thủ công qua CLI:
```bash
# Đăng nhập tài khoản Cloudflare
pnpm exec wrangler login

# Thiết lập các Secrets quan trọng
pnpm exec wrangler secret put DATABASE_URL
pnpm exec wrangler secret put JWT_SECRET
pnpm exec wrangler secret put CRON_SECRET

# Xây dựng và triển khai
pnpm deploy
```

### Triển khai tự động (CI/CD / Workers Builds):
- **Build command:** `npx opennextjs-cloudflare build`
- **Deploy command:** `npx opennextjs-cloudflare deploy`
- Khai báo các biến `NEXT_PUBLIC_*` trong mục Build Variables của Cloudflare Dashboard.

> [!NOTE]
> Môi trường Cloudflare Workers là Serverless stateless. Cờ cấu hình `CLOUDFLARE_WORKERS=1` trong `wrangler.jsonc` sẽ tự động vô hiệu hóa các kết nối WebSocket vô hạn và chuyển sang cơ chế REST polling thông minh, bảo vệ hệ thống không vượt hạn mức CPU/subrequest.

---

## 📁 Cấu trúc Thư mục Dự án

```text
├── .github/workflows/         # Kịch bản CI/CD GitHub Actions
├── docs/                      # Tài liệu kiến trúc, API và kiểm toán hệ thống
├── public/                    # Tài nguyên tĩnh, Brand logo (icon.svg, orca-mark.svg)
├── src/
│   ├── app/                   # App Router: Các trang giao diện và API endpoints (/api/v1)
│   ├── components/            # UI components, Panels (Valuation, DCF, Order Book, DataStateView)
│   ├── db/                    # Drizzle ORM schema (23 bảng dữ liệu) và client
│   ├── features/              # Module nghiệp vụ chuyên sâu (Personal Finance, v.v.)
│   └── lib/
│       ├── __tests__/         # Bộ kiểm thử đơn vị & tích hợp (140 tests)
│       ├── ai/                # AI Gateway, Prompt Templates và Model Cascade Router
│       ├── data-engine/       # Bộ bảo vệ ngân sách Workers (workers-guard.ts)
│       ├── engines/           # Các động cơ định giá (DCF, Multiples, ICT/SMC/VSA)
│       ├── financial/         # Chuẩn hóa BCTC, FCF, CAPEX, TTM
│       ├── providers/         # Bộ chuyển đổi dữ liệu nhà cung cấp (VNDirect, SSI, Binance, v.v.)
│       ├── freshness.ts       # Quản trị SLA độ tươi mới dữ liệu (LIVE, FRESH, DELAYED, STALE)
│       ├── quality.ts         # Giám sát chất lượng dữ liệu & Telemetry
│       ├── reconcile.ts       # Động cơ đối soát dữ liệu đa nguồn
│       └── safe-api.ts        # Bộ bọc an toàn API, Resilient Fallback và xử lý lỗi 502
├── wrangler.jsonc             # Cấu hình Cloudflare Workers & Rate Limiting
└── open-next.config.ts        # Cấu hình OpenNext adapter cho Cloudflare
```

---

## ⚖️ Tuyên bố Miễn trừ Trách nhiệm (Disclaimer)

Nền tảng **ORCA Multi-Finance** chỉ cung cấp dữ liệu, mô hình định giá định lượng và công cụ phân tích phục vụ cho mục đích **thông tin, nghiên cứu và học thuật**. Mọi thông tin và kết quả từ hệ thống không cấu thành lời khuyên đầu tư, khuyến nghị mua/bán hay chào mời giao dịch bất kỳ chứng khoán hoặc sản phẩm tài chính nào. Người dùng chịu hoàn toàn trách nhiệm đối với các quyết định đầu tư của mình.

---

<div align="center">
  <p>© 2026 <strong>ORCA Multi-Finance</strong>. Bản quyền thuộc về đội ngũ phát triển.</p>
</div>
