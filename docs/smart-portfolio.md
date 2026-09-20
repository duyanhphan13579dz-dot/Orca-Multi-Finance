# Smart Portfolio

Smart Portfolio là lớp điều phối phía trên hai module local-first hiện có: `watchlist` và `trade journal`. Mục tiêu là trả lời nhanh bốn câu hỏi vận hành: đang theo dõi gì, đang có exposure nào, hiệu suất thực tế ra sao, và hành động/rủi ro nào cần ưu tiên.

## Phạm vi hiện tại

Trang `/portfolio` hợp nhất watchlist và nhật ký lệnh trong một control center. Dữ liệu cũ từ `orca.watchlist.v1` và `orca.journal.v1` được đọc nguyên trạng, vì vậy người dùng không cần migrate dữ liệu trên trình duyệt. Thay đổi trên hai trang gốc phát sự kiện `orca:watchlist` và `orca:journal`, khiến Smart Portfolio cập nhật mà không cần reload.

Engine `src/lib/portfolio.ts` là pure TypeScript và không gọi provider. Engine tính realized PnL, unrealized PnL theo mark hiện có, exposure, risk tới stop loss, phân bổ theo asset class, win rate, profit factor, expectancy, average R, max drawdown và discipline score. Engine cũng tạo action queue cho vị thế thiếu stop loss, gần stop loss/take profit hoặc quá tập trung theo asset class. Ngoài snapshot KPI, engine xuất `performanceByAsset` gồm PnL, số lệnh, số lệnh thắng và win rate theo asset class để UI vẽ biểu đồ mà không lặp lại logic tính toán.

Overview hiển thị hai biểu đồ lấy trực tiếp từ snapshot: biểu đồ cột ngang PnL theo nhóm tài sản, có phân biệt lãi/lỗ và win rate; và biểu đồ tròn allocation exposure, có màu lát, phần trăm và tổng exposure ở tâm. Cả hai dùng HTML/CSS native, không thêm dependency chart nặng, có trạng thái rỗng khi chưa đủ dữ liệu và co giãn theo màn hình.

Smart Portfolio hiện là điểm vào hợp nhất cho **Tổng quan**, **Vị thế**, **Nhật ký lệnh** và **Theo dõi**. Tab Nhật ký dùng chung các key localStorage cũ nên không mất dữ liệu. Sidebar không còn đặt `/journal` như một module ngang hàng; route cũ vẫn tồn tại để tương thích liên kết cũ.

Engine bổ sung `stopLossCoverage` và `portfolioScore`. Portfolio Score là điểm tổng hợp có trọng số của kỷ luật ghi lệnh, edge từ profit factor, risk-to-exposure và trạng thái volatility. Điểm này dùng như một tín hiệu chất lượng danh mục, không phải khuyến nghị mua/bán.

AI Portfolio Coach được đặt ngay trên Tổng quan. Request gửi cả nhật ký lệnh và `portfolioContext` gồm exposure, risk, score, stop-loss coverage, allocation, volatility, alerts và watchlist count. Khi LLM khả dụng, AI nhận xét ở cấp danh mục; khi không khả dụng, service vẫn trả deterministic analysis an toàn dựa trên dữ liệu đã có.

## Risk alert theo biến động

Engine xuất thêm `volatilityByAsset`. Với mỗi nhóm tài sản có vị thế mở, hệ thống lấy giá trị tuyệt đối của `changePercent` từ quote hiện tại và tính trung bình có trọng số theo exposure. Đây là **proxy biến động tức thời**, không phải historical volatility hay ATR. Ngưỡng được đặt thận trọng theo asset class: Crypto cảnh báo cao từ 4% và cực cao từ 7%; Stock từ 2,5%/5%; Forex từ 0,8%/1,5%; Commodity từ 2%/4%.

Khi nhóm tài sản đạt mức cao hoặc cực cao, engine tự thêm risk alert vào action queue. UI đồng thời hiển thị volatility monitor với mức Thấp, Tăng, Cao, Cực cao hoặc Chưa có mark. Cơ chế chỉ cảnh báo và không tự đóng lệnh. Chu kỳ cập nhật tuân theo polling quote hiện có của trang (Crypto khoảng 20 giây, Forex khoảng 60 giây); chưa gửi thông báo ra email/push và không chạy khi người dùng đóng trình duyệt.

Giá mark chỉ được lấy từ API nội bộ hiện có cho crypto và forex. Cổ phiếu Việt Nam hoặc hàng hóa chưa có mark thì hiển thị trạng thái chưa có giá, không dùng giá giả và không cộng vào unrealized PnL. Đây là cách tuân thủ nguyên tắc freshness/provenance của ORCA.

## Quyết định thiết kế

Smart Portfolio được thêm như route riêng thay vì phá vỡ `/watchlist` và `/journal`. Hai trang cũ tiếp tục là nơi nhập/chỉnh sửa dữ liệu, còn `/portfolio` là nơi tổng hợp. Sidebar đưa Smart Portfolio lên làm entry point chính nhưng vẫn giữ liên kết trực tiếp tới hai module chi tiết.

Phiên bản này chưa bật đồng bộ server cho watchlist và trade journal. Repo đã có các bảng `watchlists`, `watchlist_items` và `trade_journal`, nhưng chưa có session-aware CRUD API cho hai miền dữ liệu này. Việc thêm sync mà không thiết kế conflict resolution, ownership và migration cho dữ liệu local sẽ làm thay đổi sản phẩm và có nguy cơ ghi đè dữ liệu. Đây là phase tiếp theo, không nên trộn vào lớp analytics local-first.

## Nguyên tắc phân tích

Win rate phải được xem cùng profit factor và expectancy; win rate cao không tự chứng minh chiến lược có lợi thế. Phân bổ và concentration giúp nhận diện exposure quá lớn ở một asset class. Drawdown được tính trên chuỗi PnL của lệnh đã đóng theo thời gian đóng, nên đây là chỉ báo kỷ luật theo trade sequence, không phải equity curve đầy đủ theo từng tick. Khi chưa đủ dữ liệu, UI hiển thị `—` hoặc “chưa đủ mẫu” thay vì suy diễn.

Tham khảo mô hình portfolio tracker về unified view, real-time gains/losses, allocation, diversification và risk metrics từ [Trademetria](https://trademetria.com/blog/portfolio-tracker-the-ultimate-tool-for-smart-portfolio-management/). Định nghĩa win rate, profit factor, ROI, Sharpe và drawdown được đối chiếu với [Option Alpha Performance Metrics](https://optionalpha.com/learn/performance-metrics). Các nguồn này chỉ dùng làm tham chiếu khái niệm; Smart Portfolio không tạo khuyến nghị đầu tư.

## Roadmap phase tiếp theo

Có thể bổ sung server sync sau khi thống nhất mô hình tài khoản/portfolio, API CRUD có ownership theo session, import/export JSON/CSV, cost basis nhiều lần vào/ra, benchmark VN-Index, equity curve theo ngày và quote provider cho cổ phiếu Việt Nam. Những phần này cần schema/API riêng và không nên giả lập bằng localStorage.
