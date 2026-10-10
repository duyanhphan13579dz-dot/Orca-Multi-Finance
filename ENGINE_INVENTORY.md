# ORCA Multi-Finance — Engine Inventory (Phase 1)

Tổng hợp danh mục, công thức, đầu vào/đầu ra, đơn vị đo lường và tình trạng kiểm thử của toàn bộ các engine tính toán tài chính và định lượng trong dự án.

---

## 1. Danh sách Engine cốt lõi

### 1.1. Ratio Engine & Financial Health (`ratio-engine.ts`, `fundamental.ts`)
- **Vị trí file:** `src/lib/financial/ratio-engine.ts`, `src/lib/engines/fundamental.ts`
- **Mục đích:** Tính toán 28+ chỉ số tài chính BCTC và đánh giá điểm sức khỏe tài chính toàn diện (Solvency, Liquidity, Profitability, Efficiency, Cash Flow).
- **Đầu vào:** `NormalizedMetrics` (Doanh thu, LNST, Nợ vay ngắn/dài hạn, Vốn CSH, Tổng tài sản, Dòng tiền HĐKD, Hàng tồn kho...), thị giá (`priceQuote`), số cổ phiếu lưu hành (`sharesOutstanding`).
- **Đầu ra:** Điểm sức khỏe `score: 0-100`, hạng xếp loại (A/B/C/D), ma trận tỷ số phân theo nhóm, danh sách cờ rủi ro (`flags`), cờ âm VCSH, âm EBITDA.
- **Xử lý biên & lỗi:**
  - Thiếu nợ vay hoặc tiền mặt: Giữ `null` thay vì tự điền 0.
  - Âm VCSH: Gán cờ rủi ro mất an toàn vốn nghiêm trọng (điểm đòn bẩy <= 25).
  - Âm EBITDA: Để `netDebtToEbitda` là `null`, không tạo bội số âm giả tạo.
- **Tình trạng test:** Đã có `src/lib/__tests__/fundamental-ratio-regressions.test.ts` (16 test cases hồi quy đạt 100%).

---

### 1.2. Valuation Engine Phases 1–6 (`valuation-phase1.ts` đến `phase6.ts`, `valuation.ts`)
- **Vị trí file:** `src/lib/engines/valuation-phase*.ts`, `src/lib/engines/valuation.ts`
- **Mục đích:** Định giá doanh nghiệp theo đa phương pháp kết hợp:
  - **Phase 1:** Bội số thị trường cơ bản (P/E, P/B, P/S, EV/EBITDA, EV/Sales, Earnings Yield).
  - **Phase 2:** Định giá dòng tiền tự do doanh nghiệp (FCFF) và dòng tiền tự do chủ sở hữu (FCFE), bội số P/FCF, EV/FCFF, so sánh trung vị lịch sử 3 năm và nhóm doanh nghiệp cùng ngành (Peers).
  - **Phase 3:** Mô hình chiết khấu dòng tiền (DCF Gordon 5 năm + Terminal Value), ma trận độ nhạy WACC × Terminal Growth rate, 3 kịch bản Bear/Base/Bull.
  - **Phase 4:** Mô hình Thu nhập thặng dư (Residual Income - RI), Chiết khấu cổ tức 2 giai đoạn (DDM), Giá trị tài sản ròng (NAV), Định giá từng phần (SOTP).
  - **Phase 5:** Trọng số ngành kết hợp (Industry Weights Blend: Ngân hàng ưu tiên RI thay vì DCF; Bất động sản ưu tiên NAV; Công nghệ ưu tiên DCF), dải biên độ giá trị hợp lý (Confidence Bands Low/Base/High) và Valuation Score (0–100).
  - **Phase 6:** Tổng hợp Snapshot báo cáo định giá, phân tích khoảng trống định giá (Valuation Gap) và giải trình định tính (Deterministic Narrative).
- **Đơn vị & Quy đổi:**
  - BCTC sử dụng đơn vị VND đầy đủ.
  - Thị giá HOSE sử dụng đơn vị nghìn đồng (`priceQuote < 500 ? × 1000 : 1`).
  - Fair Value đầu ra được chuẩn hóa khớp với đơn vị quote của thị trường.
- **Tình trạng test:** Đã có bộ test hoàn chỉnh từ Phase 1 đến Phase 6 (`src/lib/__tests__/valuation-phase1.test.ts` đến `valuation-phase6.test.ts` và `valuation-pipeline.test.ts` — tổng cộng 143 test cases đạt 100%).

---

### 1.3. Technical Indicators & Oscillators (`oscillators.ts`, `candlestick-patterns.ts`)
- **Vị trí file:** `src/lib/engines/oscillators.ts`, `src/lib/engines/candlestick-patterns.ts`
- **Mục đích:** Tính toán các chỉ báo kỹ thuật cốt lõi:
  - RSI (14 chu kỳ), MACD (12, 26, 9), Bollinger Bands (20, 2), Stochastic (14, 3, 3), ATR (14).
  - Nhận diện 20+ mô hình nến Nhật (Doji, Hammer, Engulfing, Morning Star, Evening Star, Harami...).
- **Đầu vào:** Mảng nến OHLCV (`time, open, high, low, close, volume`).
- **Đầu ra:** Mảng giá trị chỉ báo tương ứng theo từng nến; danh sách mô hình nến phát hiện kèm độ tin cậy và chiều hướng (Bullish / Bearish).
- **Tình trạng test:** Đã có `src/lib/__tests__/candlestick-patterns.test.ts` và `src/lib/__tests__/chart-engine.test.ts`.

---

### 1.4. Money Flow, VSA, ICT & SMC Engine (`money-flow.ts`)
- **Vị trí file:** `src/lib/engines/money-flow.ts`
- **Mục đích:** Phân tích dòng tiền thông minh theo trường phái Smart Money Concepts (ICT/SMC) và Phân tích biến động giá - khối lượng (VSA):
  - Nhận diện phá vỡ cấu trúc (BOS — Break of Structure) và thay đổi đặc tính (CHOCH — Change of Character).
  - Vòng đời khoảng trống giá trị hợp lý (FVG Lifecycle: Open, Partial, Filled).
  - Vùng tích lũy dòng tiền (Order Blocks - OB), kiểm tra giảm thiểu (Mitigation), Breaker Blocks.
  - Quét thanh khoản (Liquidity Sweep) và các mức thanh khoản ngang hàng (Equal Highs / Equal Lows).
  - Khung giao dịch (Dealing Range), vùng chiết khấu / cao cấp (Discount / Premium / OTE).
  - Khối lượng tương đối (RVOL), kiểm định Nỗ lực so với Kết quả (Effort vs Result / Absorption).
- **Đầu ra:** `MoneyFlowAnalysis` bao gồm điểm dòng tiền (`flowScore: -100 đến +100`), trạng thái (`flowState`), hướng (`flowDirection`), danh sách FVG và Order Blocks còn hiệu lực.
- **Tình trạng test:** Đã có `src/lib/__tests__/money-flow.test.ts` (8 tests đạt).

---

### 1.5. Divergence Engine (`divergence.ts`)
- **Vị trí file:** `src/lib/engines/divergence.ts`
- **Mục đích:** Phát hiện phân kỳ thường (Regular) và phân kỳ ẩn (Hidden) giữa đường giá và các bộ dao động (RSI, MACD Histogram, MACD Line, Stochastic).
- **Thuật toán:** Tìm đỉnh/đáy cục bộ bằng thuật toán swing window; so sánh hướng di chuyển của đỉnh/đáy giá với đỉnh/đáy của indicator tương ứng.
- **Tình trạng test:** Đã có `src/lib/__tests__/divergence.test.ts` (11 tests đạt).

---

### 1.6. Multi-Timeframe Bias Engine (`mtf-bias.ts`)
- **Vị trí file:** `src/lib/engines/mtf-bias.ts`
- **Mục đích:** Tổng hợp xu hướng và trạng thái kỹ thuật trên đa khung thời gian (ví dụ Ngày / Tuần / Tháng hoặc 1H / 4H / 1D).
- **Đầu ra:** Điểm định hướng hợp lưu (`biasScore`), trạng thái đồng thuận (Confluence) hoặc mâu thuẫn khung thời gian (Conflicted).
- **Tình trạng test:** Đã có `src/lib/__tests__/mtf-bias.test.ts` (3 tests đạt).

---

### 1.7. CANSLIM Screener Engine (`canslim.ts`)
- **Vị trí file:** `src/lib/engines/canslim.ts`
- **Mục đích:** Lọc và chấm điểm cổ phiếu theo hệ thống 7 tiêu chí CANSLIM của William J. O'Neil:
  - C: Tăng trưởng LNST quý hiện tại (>= 20-25%).
  - A: Tăng trưởng LNST hàng năm (>= 20-25% trong 3 năm).
  - N: Sản phẩm mới, ban lãnh đạo mới, đỉnh giá mới.
  - S: Cung cầu cổ phiếu, khối lượng bứt phá (Volume Expansion).
  - L: Cổ phiếu dẫn dắt (Leader vs Laggard, Sức mạnh giá RS >= 70-80).
  - I: Sự bảo trợ của nhà đầu tư tổ chức (Institutional Sponsorship).
  - M: Xu hướng thị trường chung (Market Direction).
- **Tình trạng test:** Đã có `src/lib/__tests__/canslim-engine.test.ts`.

---

### 1.8. Alpha-Beta & Trend Template Engines (`alpha-beta.ts`, `wyckoff-elliott.ts`)
- **Vị trí file:** `src/lib/engines/alpha-beta.ts`, `src/lib/engines/wyckoff-elliott.ts`
- **Mục đích:**
  - Đo lường Beta so với VN-Index và Alpha Jensen.
  - Nhận diện 8 tiêu chí xu hướng Minervini Trend Template (MA50 > MA150 > MA200).
  - Phân tích pha chu kỳ Wyckoff (Pha A: Dừng xu hướng; Pha B: Tích lũy; Pha C: Rũ bỏ Spring; Pha D: Tăng giá trong vùng; Pha E: Bứt phá).

---

### 1.9. Scalp & Realtime Trading Engines (`scalp.ts`, `forex-scalp.ts`)
- **Vị trí file:** `src/lib/engines/scalp.ts`, `src/lib/engines/forex-scalp.ts`
- **Mục đích:** Tạo tín hiệu lướt sóng tần suất cao trên thị trường Crypto và Forex dựa trên chênh lệch giá, EMA ngắn hạn, thanh khoản sổ lệnh và xung lực nến 1m/5m/15m.
- **Đầu vào:** Nến ngắn hạn và orderbook depth.

---

### 1.10. Personal Finance & Portfolio Engines (`src/lib/portfolio.ts`, `src/features/personal-finance/`)
- **Vị trí file:** `src/lib/portfolio.ts`, `src/features/personal-finance/engines/`
- **Mục đích:**
  - Quản lý danh mục đa tài sản: Cổ phiếu, Crypto, Forex, Hàng hóa.
  - Đo lường Exposure, Tỷ lệ thắng (Win Rate), Profit Factor, Max Drawdown, Tỷ lệ R:R trung bình.
  - Tính toán PnL danh mục và cảnh báo vi phạm kỷ luật (không đặt Stop Loss, quá đòn bẩy).
  - Mô phỏng tài chính cá nhân độc lập tài chính / hưu trí sớm (FIRE), phân bổ dòng tiền 50/30/20, tái cân bằng tài sản.
- **Tình trạng test:** Có `engineTests.ts` (pass) và `portfolio.test.ts` (hiện đang fail 3 tests do xung đột tính phí giao dịch gộp/ròng - xem BUG-01).
