# Rà soát định giá, Fundamental Analysis và Screener

**Ngày:** 09-10-2026  
**Phạm vi:** định giá doanh nghiệp, financial health/fundamental metrics, logic so sánh kỳ, bộ lọc fundamental/valuation và đường lấy quote/BCTC dùng chung. Đây là rà soát mã nguồn và test hồi quy; chưa phải xác nhận độ chính xác của từng giá trị ticker với dữ liệu thực đang giao dịch.

## Tóm tắt

Đã phát hiện và sửa một số sai lệch có thể ảnh hưởng trực tiếp đến tăng trưởng YoY, ROE/ROA, quick ratio, net debt, điểm financial health và kết quả cache của custom universe. Các sửa đổi đã được kiểm thử ở mức unit/screener logic.

Phần còn lại quan trọng nhất là **quy mô quét synchronous còn nhỏ so với toàn bộ thị trường** và **các tiêu chí chấm điểm ngân hàng chưa tách khỏi tỷ số chung của doanh nghiệp phi tài chính**. Không nên nâng giới hạn quét hàng loạt trong Workers một cách đơn giản; cần chuyển sang tiền tính/lưu snapshot theo lô, có giới hạn tài nguyên và timestamp/source rõ ràng.

## Phát hiện và thay đổi đã áp dụng

| Mức độ | Phát hiện | Hệ quả | Thay đổi |
|---|---|---|---|
| Cao | Ratio engine có thể lấy TTM hiện tại so với quý gần nhất, hoặc lấy quý hiện tại so quý trước, cho tăng trưởng mang nhãn YoY. | Tăng trưởng doanh thu/lợi nhuận có thể bị phóng đại hoặc sai kỳ; PEG và các bộ lọc tăng trưởng tiếp tục nhận sai đầu vào. | TTM chỉ so với TTM cùng kỳ năm trước (dịch 4 quý); quý chỉ so cùng quý năm trước; khi không đủ lịch sử thì trả `null`. |
| Cao | Snapshot đổi `changePct` theo heuristic: ratio trong khoảng ±3 thì nhân 100, còn lớn hơn thì coi là đã là percent. | Với tăng trưởng >300%, giá trị có thể bị co sai 100 lần, ví dụ `4.0` (400%) thành `4.0%`. | `GrowthSnapshot.changePct` được chuẩn hóa theo hợp đồng ratio thập phân: luôn nhân 100 đúng một lần tại snapshot boundary. |
| Cao | Thiếu nợ ngắn hạn hoặc dài hạn bị xem như 0; thiếu cash bị xem như 0 trong net-debt; quick ratio xem inventory thiếu như 0. | Có thể tạo D/E, net debt/EBITDA, EV/EBITDA và thanh khoản nhanh lạc quan giả. | Chỉ cộng debt khi đủ hai cấu phần; net debt cần cash; quick ratio trả `null` nếu thiếu cả breakdown TSNH–inventory lẫn cash+receivables. Cảnh báo thiếu debt bucket riêng. |
| Cao | ROIC dùng thuế suất cố định 20% mà không thông báo; vốn đầu tư có thể lấy equity/debt/cash hiện tại. | Sai lệch theo mức thuế và biến động bảng cân đối; người dùng khó biết số nào là ước tính. | Dùng thuế suất hiệu dụng TTM nếu đầy đủ/hợp lệ; fallback 20% có cảnh báo/note. Với kỳ prior sẵn có, dùng vốn đầu tư bình quân. |
| Trung bình | ROE/ROA và vòng quay trong ratio engine dùng số dư cuối kỳ dù có prior period. | Không theo thông lệ tài chính dùng số dư bình quân cho flow / stock ratios. | ROE/ROA, vòng quay tài sản/VCSH/tồn kho/phải thu dùng bình quân current/prior khi có prior; nếu không có prior vẫn dùng số dư hiện tại và không bịa kỳ trước. |
| Trung bình | Điểm overall nhân trọng số rồi lấy trung bình trên các nhóm có dữ liệu, làm nhóm thiếu dữ liệu kéo điểm xuống như điểm 0. | Công ty có coverage thấp có thể bị phạt điểm ngoài ý nghĩa kinh tế; khó so sánh giữa mức độ đầy đủ BCTC. | Chia tổng điểm có trọng số cho tổng trọng số của các nhóm thực có điểm; coverage và cảnh báo thiếu dữ liệu vẫn giữ riêng. |
| Trung bình | Fundamental screener cache key dùng universe length + 8 mã đầu. | Hai custom universes khác nhau nhưng cùng 8 mã đầu và cùng độ dài có thể trả nhầm kết quả cache. | Cache key phiên bản mới chứa toàn bộ danh sách mã đã chuẩn hóa. |
| Thấp | `Map` quotes trong fundamental/valuation/Minervini/divergence screener không lọc key symbol trước khi tạo map. | Type inference có thể thành `unknown`, và quote không có symbol không nên tham gia merge. | Tạo map có type rõ, chỉ đưa quote có symbol vào. |
| Trung bình | Risk flags chưa áp dụng ngưỡng `maxDebtEquity` và `minCurrentRatio` dù profile ngành đã khai báo. | Có thể bỏ sót cảnh báo leverage/thanh khoản theo ngưỡng profile. | Thêm hai nhóm risk flags này khi profile đặt ngưỡng. |
| Trung bình | Divergence screener đưa tối đa 20 symbol đầu vào cache key custom universe. | Hai yêu cầu cùng 20 mã đầu nhưng khác phần còn lại có thể trả cache cùng kết quả. | Cache key mới chứa toàn bộ universe đã chuẩn hóa. |
| Trung bình | Minervini ghi nhận high/low 52 tuần và return 126/252 ngày bằng lịch sử ngắn hơn nếu mã mới niêm yết. | 50 phiên có thể bị trình bày như return 6–12 tháng/52 tuần; RS proxy giữa các mã không cùng horizon. | Chỉ tính 126/252-session return và 52-week high/low khi đủ lịch sử; nếu không, trả `null` để bộ lọc không hiểu nhầm. |
| Thấp | Divergence strength được khai báo có thể là số nhưng filter/ranking chỉ xử lý như chuỗi. | Mất tương thích kiểu, nguy cơ lọc/xếp hạng sai khi input đến theo dạng số. | Chuẩn hóa strength string/numeric trước khi áp ngưỡng/rank; định tuyến cache vẫn phụ thuộc đầy đủ universe. |

### Ví dụ hồi quy tăng trưởng

Test cố định 8 quý: TTM hiện tại = 100, TTM trước = 60; doanh thu quý cuối năm trước = 20. Kết quả đúng là **66,7% TTM YoY**, không phải so TTM 100 với một quý 20 hoặc 30. Khi chỉ có quý, Q4/2025 so với Q4/2024 là 50% trong fixture.

## Rà soát đường dữ liệu và độ rộng quét

- `getVnQuotes` trong `stocks-board.ts` đi qua `getMultiQuotes`, sau đó fallback public feed và VNDirect; quote routes được hợp nhất qua `hubVnQuotes`. Đây là nền dùng chung hợp lý cho nhiều use case, có metadata nguồn/partial và không chỉ gắn cứng một upstream.
- `getVnOhlcv` có chuỗi public OHLCV → VNDirect DChart → SSI FCData; `getVnUniverseList` ưu tiên danh mục HOSE/HNX/UPCOM rồi mới fallback board/liquid list.
- `WORKERS_BUDGET` đang giới hạn fundamental universe mặc định **80**, cứng tối đa **120**, technical universe **60**; OHLCV screener mặc định 100 bars và concurrency 4. Vì vậy kết quả quét hiện tại là universe có giới hạn, không nên hiểu là đã sàng toàn bộ khoảng 1.900 mã.
- Fundamental snapshots chạy mặc định concurrency **2**. BCTC package có cache 6 giờ và stale window dài để giảm tải upstream; snapshot 18 giờ; từng screener còn cache riêng. Điều này giúp request nóng ổn định, nhưng cold-cache/full-universe synchronous scan vẫn có thể vượt ngân sách thời gian/subrequests.
- Valuation screener ghép quote hub, financial snapshots và VNDirect valuation ratios theo mã (pool có giới hạn); khi mở rộng universes, gọi ratio từng mã và cold BCTC là phần cần đo/giảm tải trước.
- Các technical screeners khác nhau dùng batch OHLCV hoặc pool per-symbol (ví dụ Elliott/Wyckoff/Alpha-Beta); volume/liquidity priority và số mã được scan chưa hoàn toàn đồng nhất giữa screeners. Minervini RS rating hiện là percentile tương đối **trong universe đang quét**, không phải IBD RS chuẩn hoặc một xếp hạng ổn định qua các universe khác nhau.
- `fetchOhlcvResilient` dùng `firstHealthy` theo chuỗi nhưng adapter không truyền tiếp AbortSignal; khi chuỗi thất bại nó còn thử `raceHealthy` rồi `getVnOhlcv`. Một request upstream chậm có thể còn chạy nền sau timeout trong lúc fallback bắt đầu, làm tăng subrequests/trùng tải khi provider nghẽn. **Đây là điểm cần sửa riêng** bằng signal-aware providers hoặc một deadline/cascade duy nhất có quan sát rõ; chưa đổi fallback contract ở lượt này để không vô tình giảm coverage.

### Đề xuất tiếp theo để mở rộng quét và kết nối dữ liệu

1. Tạo **pipeline tiền tính snapshot theo batch** từ universe cập nhật, lưu symbol, kỳ báo cáo, nguồn, fetchedAt/freshness, chất lượng và quote timestamp; screeners chỉ truy vấn/ghép snapshot đã lưu. Dùng cursor/chunk + backpressure thay vì một request gọi trực tiếp cho hàng trăm mã.
2. Hợp nhất contract market/financial data thành record chuẩn: giá/thời điểm/nguồn/thị trường; BCTC/period/unit/scope/audit/source. Không trộn giá nghìn đồng với số liệu VND đầy đủ và không coi missing là zero.
3. Ưu tiên dynamic universe theo sàn, thanh khoản và trạng thái niêm yết; hỗ trợ chạy từng segment và tổng hợp kết quả thay vì tăng `screenerUniverseMax` đồng loạt.
4. Đo p50/p95 latency, hit/stale/partial, symbols requested/returned và provider attempts theo từng endpoint; cảnh báo khi coverage tụt, data stale hoặc mismatch nguồn.
5. Định nghĩa score riêng cho ngân hàng/chứng khoán/bất động sản/phi tài chính. Với ngân hàng cần NIM, NPL, CASA, LDR, CAR/CET1 và chỉ số thanh khoản phù hợp; D/E và current ratio phổ thông không thể đại diện chất lượng ngân hàng. Cho tới khi có bộ dữ liệu đó, điểm generic giữa ngân hàng và doanh nghiệp khác **không nên xếp hạng trực tiếp**.
6. Bổ sung kiểm thử PIT (point-in-time) và survivorship-aware cho historical backtest: chỉ dùng BCTC sau ngày công bố, xử lý cổ phiếu hủy niêm yết/thay universe, điều chỉnh cổ tức/split, và không dùng dữ liệu tương lai trong bộ lọc.

## Phạm vi chưa được thay đổi

- Chưa tăng `screenerUniverse`/`screenerUniverseMax`: nâng trần mà không có precompute/persistent snapshot sẽ tăng nguy cơ timeout, Workers subrequest exhaustion và provider throttling.
- Chưa xây dựng lại scoring ngân hàng/ngành đặc thù; thiếu các trường chuẩn CAR/CET1, NPL, NIM, CASA, LDR/NSFR trong contract hiện tại. Tốt hơn là chỉ rõ giới hạn thay vì gán điểm đại diện không có cơ sở.
- Chưa thực hiện live reconciliation từng mã giữa VNDirect/SSI/public feed và BCTC; cần chạy tác vụ đối chiếu có tập mã, thời điểm và ngưỡng sai số định trước.
- DCF/multiples và phase scoring nhiều phương pháp đã có sẵn; các cải tiến trong lượt này tập trung vào độ đúng của đầu vào tài chính, kỳ so sánh và coverage chứ không thay đổi giả định discount rate/terminal growth/peer selection.

## Kiểm thử và trạng thái chất lượng

- `npm test`: **35/35 Node test cases đạt**; regression mới bao gồm tăng trưởng TTM/quý cùng kỳ, số dư bình quân, missing debt/cash/inventory, renormalize score và đơn vị growth >300%.
- ESLint trên các file thay đổi: đạt; `git diff --check`: đạt.
- `npm run typecheck`: **chưa qua toàn repo**, còn 111 lỗi TypeScript ở các file khác nhau; lần rà soát cuối không thấy lỗi trong các module tài chính/screener đã chỉnh. Một phần lỗi quote-map/fallback type trực tiếp trong screener đã được sửa, nhưng phần lớn lỗi còn lại là type debt trên các route/components/services khác. Không nên diễn giải là toàn bộ repo đã type-safe.
