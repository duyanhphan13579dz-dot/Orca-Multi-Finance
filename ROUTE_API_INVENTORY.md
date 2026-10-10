# ORCA Multi-Finance — Route & API Inventory (Phase 1)

Tổng hợp toàn bộ route giao diện (UI) và route API trong dự án `Orca-Multi-FN`.

---

## 1. Giao diện người dùng (UI Routes)

| Đường dẫn (Route) | Phân loại | Mục đích | Nguồn dữ liệu chính | Auth | Ghi chú Trạng thái |
|---|:---:|---|---|:---:|---|
| `/` | Trang chủ | Tổng quan thị trường Việt Nam & thế giới | VN Stocks, Crypto, Forex, Hàng hóa | Public | Static pre-rendered |
| `/stocks` | Bảng giá | Bảng giá chứng khoán Việt Nam (HOSE/HNX/UPCoM) | VNDirect, VPS, SSI, CafeF | Public | Client-hydrated, realtime quotes |
| `/stocks/[symbol]` | Chi tiết | Phân tích toàn diện 1 mã cổ phiếu | DChart, BCTC, AI Analysis, Technical | Public | Dynamic server-rendered |
| `/stocks/[symbol]/profile` | Doanh nghiệp | Hồ sơ kinh doanh, ban lãnh đạo, cổ đông | Vietcap IQ, VNDirect Profile | Public | Dynamic server-rendered |
| `/stocks/[symbol]/financials` | BCTC | Bảng CĐKT, KQKD, LCTT, Chỉ số tài chính | VNDirect Finfo, VNStock, ADF Portal | Public | Bảng pivot đa kỳ, hỗ trợ so sánh |
| `/stocks/[symbol]/fundamentals` | Sức khỏe | Đánh giá sức khỏe tài chính & mô hình Altman Z, Piotroski | Ratio Engine, Fundamental Engine | Public | Đã có cơ chế xử lý missing data |
| `/stocks/[symbol]/valuation` | Định giá | Mô hình DCF, P/E, P/B, EV/EBITDA, Gordon, SOTP | Valuation Engine Phase 1–6 | Public | 3 kịch bản Bear/Base/Bull |
| `/stocks/sectors` | Ngành nghề | Phân bổ dòng tiền theo 19 nhóm ngành | VNDirect Sector, ICB | Public | Heatmap & RS tương đối |
| `/crypto` | Crypto Hub | Bảng giá tiền mã hóa, vốn hóa, biến động | Binance Vision, OKX, CoinGecko | Public | Top 300 cặp USDT |
| `/crypto/[symbol]` | Chi tiết Crypto | Biểu đồ nến, Orderflow, Scalp analysis | Binance REST & WS, fapi | Public | Hỗ trợ nến đa khung thời gian |
| `/forex` | Ngoại hối | Tỷ giá tiền tệ thế giới & tỷ giá VCB/NHNN | Biquote MT5, Yahoo FX, Frankfurter | Public | Intraday & tham chiếu |
| `/forex/[symbol]` | Chi tiết FX | Phân tích kỹ thuật & scalp ngoại hối | Biquote, Forex Scalp Engine | Public | Dynamic server-rendered |
| `/commodities` | Hàng hóa | Bảng giá vàng, bạc, dầu, thép HRC, nông sản | VietnamBiz Goods, Yahoo Futures | Public | 6 nhóm mặt hàng |
| `/macro-economic` | Kinh tế vĩ mô | GDP, CPI, FDI, Lãi suất, Tín dụng, Xuất nhập khẩu | World Bank, FRED, SBV | Public | Biểu đồ chuỗi thời gian |
| `/currency-interest-rate`| Lãi suất | Lãi suất liên ngân hàng, huy động, Fed Rate | NHNN, FRED | Public | Bảng so sánh kỳ hạn |
| `/heatmap` | Bản đồ nhiệt | Bản đồ nhiệt thị trường chứng khoán | VPS, VNDirect, SSI | Public | Phân cấp theo vốn hóa & ngành |
| `/screener` | Bộ lọc cổ phiếu | Lọc kỹ thuật, cơ bản, CANSLIM, Minervini, Wyckoff | Screener Engines | Public | Responsive card trên mobile |
| `/news` | Tin tức | Tin tài chính tổng hợp từ báo chí VN | RSS CafeF, VnExpress, Tuổi Trẻ | Public | Tự động phân loại sắc thái (sentiment) |
| `/reports` | Báo cáo | Báo cáo nhận định thị trường, Morning Brief | Report Engine, AI Synthesizer | Public | Báo cáo sáng & chiều tự động |
| `/agent` | AI Analyst | Trợ lý phân tích tài chính đàm thoại thông minh | RAG Pipeline, OpenRouter, Groq | Public | Context turns, streaming |
| `/portfolio` | Quản lý DM | Sổ lệnh, phân bổ tài sản, rủi ro, PnL | LocalStorage, Data Hub Marks | Public | Khách lưu cục bộ / đồng bộ Sheets |
| `/watchlist` | Theo dõi | Danh sách theo dõi đa tài sản | LocalStorage | Public | Hỗ trợ thêm/xóa nhanh |
| `/journal` | Nhật ký GD | Ghi chép lệnh giao dịch, phân tích tâm lý & hiệu suất | LocalStorage, Journal Analyzer | Public | Hỗ trợ backtest nhật ký |
| `/settings` | Cài đặt | Cấu hình giao diện, API keys, phí giao dịch | LocalStorage & Server Sync | Public | Tùy chọn nguồn & hiển thị |
| `/system` | Vận hành | Giám sát kết nối nguồn, độ trễ, logs hệ thống | System Endpoints | Cần đăng nhập | Ops dashboard |
| `/login` | Đăng nhập | Đăng nhập tài khoản bằng email/mật khẩu | Auth API | Public | Session cookie |
| `/register` | Đăng ký | Đăng ký tài khoản người dùng mới | Auth API | Public | Bcrypt/scrypt hashing |

---

## 2. API Routes (`/api/v1/*`)

### 2.1. Xác thực & Tài khoản (Authentication)
| Method | Endpoint | Xác thực | Rate Limit | Mục đích |
|---|---|:---:|:---:|---|
| POST | `/api/v1/auth/register` | Không | 10 req/60s (`RL_AUTH`) | Đăng ký tài khoản người dùng mới |
| POST | `/api/v1/auth/login` | Không | 10 req/60s (`RL_AUTH`) | Đăng nhập, cấp cookie `orca_session` |
| POST | `/api/v1/auth/logout` | Có (Cookie) | Không | Đăng xuất, hủy phiên trong DB và xóa cookie |
| GET | `/api/v1/auth/me` | Có (Cookie) | Không | Lấy thông tin tài khoản hiện tại |
| PUT | `/api/v1/auth/profile` | Có (Cookie) | Không | Cập nhật thông tin cá nhân |
| PUT | `/api/v1/auth/password` | Có (Cookie) | Không | Đổi mật khẩu tài khoản |
| GET | `/api/v1/auth/sessions` | Có (Cookie) | Không | Danh sách các phiên đăng nhập đang hoạt động |
| DELETE| `/api/v1/auth/sessions` | Có (Cookie) | Không | Thu hồi một phiên đăng nhập theo ID |
| GET | `/api/v1/auth/activity` | Có (Cookie) | Không | Nhật ký hoạt động đăng nhập & đổi mật khẩu |

### 2.2. Thị trường Chứng khoán Việt Nam (VN Stocks)
| Method | Endpoint | Cache TTL | Nguồn / Engine | Mô tả |
|---|---|:---:|---|---|
| GET | `/api/v1/stocks` | 20s | VPS, VNDirect, SSI | Bảng giá tổng hợp chứng khoán |
| GET | `/api/v1/stocks/universe` | 24h | `SECURITY_MASTER` | Toàn bộ danh mục 1,600+ mã niêm yết |
| GET | `/api/v1/stocks/metrics` | 60s | Multi-quote Service | Chỉ số thị trường tổng quan |
| GET | `/api/v1/stocks/[symbol]` | 20s | VNDirect DChart / VPS | Chi tiết 1 mã: giá, khớp lệnh, cung cầu |
| GET | `/api/v1/stocks/[symbol]/profile` | 24h | Vietcap IQ, VNDirect Profile | Hồ sơ doanh nghiệp |
| GET | `/api/v1/stocks/[symbol]/financials`| 1h | VNDirect Finfo, VNStock | BCTC 4 báo cáo tiêu chuẩn, đa kỳ |
| GET | `/api/v1/stocks/[symbol]/fundamentals`| 1h| Ratio & Health Engine | Đánh giá sức khỏe tài chính & Altman Z |
| GET | `/api/v1/stocks/[symbol]/valuation` | 30m | Valuation Engine P1–P6 | Định giá đa phương pháp (DCF, PE, PB, DDM...) |
| GET | `/api/v1/stocks/[symbol]/valuation/analyst` | 1h | Company Research Hub | Báo cáo phân tích định giá chuyên sâu |
| GET | `/api/v1/stocks/[symbol]/technical` | 60s | Chart Core & Technical Service | Các chỉ báo RSI, MACD, MA, Bollinger |
| GET | `/api/v1/stocks/[symbol]/ratios` | 1h | Ratio Engine | Tỷ số tài chính đầy đủ (thanh khoản, đòn bẩy...) |
| GET | `/api/v1/stocks/[symbol]/foreign` | 60s | VNDirect Foreign Symbol | Khối ngoại mua/bán ròng của mã |
| GET | `/api/v1/stocks/[symbol]/events` | 12h | VNDirect Events | Lịch sự kiện, trả cổ tức, họp ĐHCĐ |
| GET | `/api/v1/stocks/[symbol]/news` | 15m | CafeF, VnExpress, VNDirect | Tin tức liên quan đến mã chứng khoán |
| GET | `/api/v1/stocks/[symbol]/filings` | 6h | SSC Portal / ADF Client | Công bố thông tin, BCTC kiểm toán |
| GET | `/api/v1/stocks/[symbol]/forecast` | 2h | Financial Forecast Engine | Dự phóng kết quả kinh doanh |
| GET | `/api/v1/stocks/[symbol]/orderbook` | Live (5s) | VPS / VNDirect Orderbook | Sổ lệnh 3 giá mua / 3 giá bán |
| GET | `/api/v1/stocks/[symbol]/orderbook/stream` | SSE | SSE Proxy | Luồng SSE sổ lệnh trực tiếp |
| GET | `/api/v1/stocks/[symbol]/structure` | 5m | Money Flow (SMC/ICT) | Cấu trúc thị trường, BOS, CHOCH, FVG |
| GET | `/api/v1/stocks/[symbol]/style-fit` | 1h | Style Fit Engine | Phân loại phong cách đầu tư (Value, Growth...) |
| GET | `/api/v1/stocks/[symbol]/tech-reco` | 5m | Trade Signal Engine | Khuyến nghị kỹ thuật đa khung thời gian |
| GET | `/api/v1/stocks/[symbol]/ai-analysis` | 15m | AI Agent Stock Analyst | Phân tích toàn cảnh bằng AI |

### 2.3. Tiền mã hóa & Ngoại hối (Crypto & Forex)
| Method | Endpoint | Cache TTL | Nguồn | Mô tả |
|---|---|:---:|---|---|
| GET | `/api/v1/crypto/markets` | 15s | Binance Vision, OKX | Bảng giá top 300 đồng tiền số |
| GET | `/api/v1/crypto/[symbol]` | 10s | Binance REST | Chi tiết 1 đồng coin (giá, 24h vol, đỉnh/đáy) |
| GET | `/api/v1/crypto/[symbol]/orderflow` | 5s | Binance Futures (fapi) | Dòng lệnh, funding rate, liquidation |
| GET | `/api/v1/crypto/[symbol]/scalp` | 5s | Scalp Engine | Tín hiệu lướt sóng đa khung thời gian |
| GET | `/api/v1/crypto/[symbol]/scalp/stream` | SSE | SSE Scalp Stream | Dòng tín hiệu scalp đẩy trực tiếp |
| GET | `/api/v1/forex/markets` | 30s | Biquote MT5, Yahoo FX | Danh sách các cặp tiền tệ chính |
| GET | `/api/v1/forex/[symbol]` | 20s | Biquote, Frankfurter | Chi tiết tỷ giá 1 cặp tiền tệ |
| GET | `/api/v1/forex/[symbol]/analysis` | 60s | Forex Scalp Engine | Phân tích kỹ thuật tỷ giá |
| GET | `/api/v1/forex/[symbol]/scalp` | 10s | Forex Scalp Engine | Tín hiệu scalp Forex |

### 2.4. Hàng hóa, Vĩ mô & Phái sinh (Commodities, Macro, Derivatives)
| Method | Endpoint | Cache TTL | Nguồn | Mô tả |
|---|---|:---:|---|---|
| GET | `/api/v1/commodities` | 10m | VietnamBiz Goods, Yahoo | 6 nhóm mặt hàng thiết yếu |
| GET | `/api/v1/commodities/fx` | 5m | Biquote, VietnamBiz | Tỷ giá quy đổi giá hàng hóa |
| GET | `/api/v1/macro-economic` | 6h | World Bank, FRED, SBV | Chỉ tiêu vĩ mô Việt Nam |
| GET | `/api/v1/macro/worldbank` | 24h | World Bank Open Data API | Dữ liệu so sánh kinh tế toàn cầu |
| GET | `/api/v1/currency-interest-rate` | 1h | NHNN, FRED | Lãi suất liên ngân hàng & Fed rate |
| GET | `/api/v1/derivatives/contracts` | 1m | HNX Derivatives | Danh sách hợp đồng tương lai VN30 |
| GET | `/api/v1/derivatives/snapshot` | 15s | HNX, VPS BGAPi | Snapshot giá và basis phái sinh |
| GET | `/api/v1/derivatives/curve` | 1m | Derivatives Curve Engine | Đường cong kỳ hạn (term structure) |
| GET | `/api/v1/derivatives/regime` | 1m | Derivatives Regime Engine | Trạng thái chênh lệch basis (contango/backwardation) |
| GET | `/api/v1/derivatives/margin` | 12h | VSDC Margin Spec | Tỷ lệ ký quỹ quy định của VSDC |
| GET | `/api/v1/derivatives/alerts` | 30s | Derivatives Alert Engine | Cảnh báo biến động bất thường phái sinh |

### 2.5. Bộ lọc cổ phiếu (Screeners)
| Method | Endpoint | Engine | Mô tả |
|---|---|---|---|
| GET | `/api/v1/screener` | Multi-Screener Hub | Bộ lọc kỹ thuật & cơ bản phối hợp |
| GET | `/api/v1/screener/canslim` | CANSLIM Engine | Lọc theo 7 tiêu chí CANSLIM của William O'Neil |
| GET | `/api/v1/screener/minervini` | Minervini Trend Engine | Lọc theo tiêu chí Trend Template của Mark Minervini |
| GET | `/api/v1/screener/wyckoff` | Wyckoff Screener | Lọc chu kỳ Tích lũy / Phân phối Wyckoff |
| GET | `/api/v1/screener/elliott` | Elliott Wave Screener | Nhận diện cấu trúc sóng Elliott |
| GET | `/api/v1/screener/divergence`| Divergence Engine | Quét phân kỳ RSI/MACD/Stoch đa khung thời gian |
| GET | `/api/v1/screener/candlestick`| Candlestick Screener | Lọc mô hình nến Nhật đảo chiều & tiếp diễn |
| GET | `/api/v1/screener/alpha-beta` | Alpha-Beta Engine | Đo lường độ nhạy thị trường (Beta) và hiệu suất vượt trội (Alpha) |
| GET | `/api/v1/screener/fundamental`| Fundamental Screener | Lọc theo ROE, biên lợi nhuận, P/E, tăng trưởng |
| GET | `/api/v1/screener/valuation` | Valuation Screener | Lọc các mã định giá thấp, chiết khấu biên an toàn cao |

### 2.6. Trợ lý AI, Báo cáo & Tin tức (AI, Reports, News)
| Method | Endpoint | Xác thực / RL | Mô tả |
|---|---|:---:|---|
| POST | `/api/v1/agent` | Rate Limit (`RL_AI` 10/60s) | Hội thoại AI tài chính (hỗ trợ streaming/SSE) |
| GET/POST | `/api/v1/reports` | Public | Danh sách & tạo báo cáo phân tích |
| GET | `/api/v1/reports/[id]` | Public | Chi tiết 1 báo cáo lưu trữ |
| GET | `/api/v1/reports/morning-brief` | Public | Báo cáo vĩ mô đầu ngày (Morning Brief) |
| GET | `/api/v1/reports/stock/[symbol]` | Public | Báo cáo nghiên cứu chuyên sâu 1 mã |
| GET | `/api/v1/news` | Cache 10m | Tin tức tài chính tổng hợp từ các đầu báo |
| GET | `/api/v1/news/bulletin` | Cache 5m | Bản tin vắn thị trường chứng khoán |
| GET | `/api/v1/news/sentiment` | Cache 15m | Chỉ số đo lường tâm lý thị trường qua tin tức |
| POST | `/api/v1/journal/analyze` | Rate Limit (`RL_AI`) | AI phân tích tâm lý & hiệu quả nhật ký giao dịch |
| POST | `/api/v1/backtest` | Rate Limit (`RL_AI`) | Backtest chiến lược hoặc nhật ký lệnh |

### 2.7. Tự động hóa & Tác vụ định kỳ (Cron Jobs)
*Tất cả route trong nhóm này đều yêu cầu `cronUnauthorized` (Xác thực qua Bearer Token hoặc `?secret=`)*.
| Method | Endpoint | Tần suất đề xuất | Tác vụ |
|---|---|:---:|---|
| GET | `/api/v1/cron/market-live` | 1–5 phút (trong phiên) | Cập nhật giá và snapshot thị trường |
| GET | `/api/v1/cron/stocks` | 15 phút (trong phiên) | Quét dữ liệu giao dịch toàn bộ cổ phiếu |
| GET | `/api/v1/cron/financials` | 6 giờ | Thu thập BCTC mới từ VNDirect & ADF |
| GET | `/api/v1/cron/reports` | 08:20 & 15:50 | Tự động sinh Morning Brief & Daily Summary |
| GET | `/api/v1/cron/alerts` | 1 phút | Quét và kích hoạt cảnh báo giá & phái sinh |
| GET | `/api/v1/cron/crypto-warm` | 5 phút | Làm nóng cache top coin |
| GET | `/api/v1/cron/forex-warm` | 15 phút | Làm nóng cache tỷ giá |
| GET | `/api/v1/cron/commodities` | 30 phút | Thu thập giá hàng hóa mới |
| GET | `/api/v1/cron/screener-warm` | 10 phút | Tính toán trước kết quả các bộ lọc nặng |

### 2.8. Vận hành & Giám sát hệ thống (System & Ops)
*Tất cả route trong nhóm này đều yêu cầu `requireInternalSession`*.
| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/v1/system/info` | Thông tin runtime, phiên bản, bộ nhớ |
| GET | `/api/v1/system/providers` | Trạng thái, tỷ lệ thành công, độ trễ từng nguồn dữ liệu |
| GET | `/api/v1/system/network-latency` | Đo kiểm độ trễ kết nối mạng tới các bên thứ ba |
| GET | `/api/v1/system/financial-monitor` | Giám sát chất lượng dữ liệu tài chính BCTC |
| GET | `/api/v1/system/financial-sources` | Danh sách trạng thái các nguồn BCTC (VNDirect, VNStock, ADF) |
| GET | `/api/v1/system/financial-validation-logs` | Nhật ký các bản ghi BCTC bị gắn cờ lỗi kế toán |
| GET | `/api/v1/system/llm` | Giám sát gateway AI, hạn mức token, độ trễ phản hồi LLM |
| GET | `/api/v1/system/ssc-calendar` | Lịch công bố thông tin Ủy ban Chứng khoán |
| GET | `/api/v1/system/ssc-listing-index` | Chỉ mục danh sách niêm yết chính thức từ UBCKNN |
| GET | `/api/v1/system/ssi-ws` | Trạng thái kết nối WebSocket SSI iBoard |
| GET | `/api/v1/ops/data-engine` | Thông tin điều phối bộ đệm và worker Data Hub |
| GET | `/api/v1/ops/vndirect-latency` | Lịch sử độ trễ và tỷ lệ lỗi của VNDirect API |
