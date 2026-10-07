# Tích hợp chế độ Tài chính cá nhân

## Kết quả khảo sát

- **Ứng dụng đích:** `Orca-Multi-Finance` — Next.js 16 App Router, React 19, Tailwind CSS v4, hiện tổ chức chức năng quanh các route đầu tư như `/stocks`, `/crypto`, `/portfolio` và `/agent`.
- **Nguồn tích hợp:** `Orca-Wallet` — React/TypeScript SPA có các chức năng monthly check-in, dòng tiền và thuế TNCN, tài sản ròng, sức khỏe tài chính, mục tiêu, dự phóng, lời khuyên, báo cáo, riêng tư và Q&A.
- Orca-Wallet lưu hồ sơ, snapshots và assumptions trong `localStorage`; không có migration backend phù hợp để nhập thẳng vào schema PostgreSQL đầu tư mà không làm thay đổi ý nghĩa hoặc rủi ro mất dữ liệu.

## Kiến trúc triển khai

- Giữ dashboard đầu tư hiện hữu tại `/` cùng toàn bộ route đầu tư hiện tại.
- Đặt module Orca-Wallet nguyên bản trong `src/features/personal-finance/` và mở qua route Next `/personal-finance`.
- Shell toàn cục suy ra mode theo route: đầu tư hoặc tài chính cá nhân. Công tắc mode luôn hiện trên thanh trên; đổi mode đưa người dùng về dashboard của mode tương ứng.
- Sidebar, nhãn thương hiệu và tiện ích toàn cục thay đổi theo mode. Chế độ cá nhân có các lối tắt tab qua URL hash; tab bên trong vẫn do module Wallet quản lý.
- Dữ liệu Wallet vẫn dùng namespace `orca_fin_*_v1`; không đụng portfolio/auth storage của ứng dụng đầu tư.

## Hành vi dữ liệu và an toàn

- Dữ liệu cá nhân hiện vẫn cục bộ trên trình duyệt này, không tự đồng bộ sang PostgreSQL, tài khoản đăng nhập, thiết bị khác hoặc module portfolio. Đây là lựa chọn bảo toàn phạm vi và tránh ghép hai mô hình dữ liệu không tương thích.
- Thành phần Ask Orca gửi yêu cầu tới `/api/ask-orca`; route đó có ở dự án Wallet gốc nhưng không có trong Orca-Multi-Finance. Thành phần hiện có fallback tính toán định lượng ở phía client khi route không sẵn sàng. Không chép server Gemini/API key hoặc bất kỳ secret nào sang frontend.
- Muốn đồng bộ cross-device về sau cần thiết kế schema/API, ownership/authz, export/import và migration riêng; không nên coi localStorage hiện tại là tài khoản cloud.

## Nguồn

- GitHub: https://github.com/duyanhphan13579dz-dot/Orca-Multi-Finance
- GitHub: https://github.com/duyanhphan13579dz-dot/Orca-Wallet
