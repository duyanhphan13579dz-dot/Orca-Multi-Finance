# Cloudflare Workers — realtime & cache

## Cache
- In-memory `Map` is **per-isolate** and ephemeral.
- Shared cache: set `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (dashboard secrets).
- TCP Redis (`redis://`) does **not** work reliably on Workers; REST is preferred.

## Report scheduler
- Do **not** rely on `setInterval` inside Workers.
- Use **cron-job.org** (or Cloudflare Cron Triggers) hitting:
  - `GET /api/v1/cron/reports?secret=$CRON_SECRET`
  - `GET /api/v1/cron/commodities?secret=$CRON_SECRET`
- Suggested cadence: every 5–15 minutes during VN session.

## SSE streams
Routes under `**/stream` are not durable on Workers.
- Prefer polling: `?mode=poll` or `Accept: application/json` or header `X-Orca-Realtime: poll`
- Interval 2–5s client-side.
- Long-term: Durable Objects / WebSocket hibernation.

## Client IP
Session metadata uses `cf-connecting-ip` (then true-client-ip / x-real-ip). Do not trust `x-forwarded-for` alone.

## Nhóm ưu tiên trung bình (bổ sung)

- **Security headers**: đặt trong `next.config.ts → headers()` (CSP, HSTS, X-Frame-Options, Permissions-Policy) nên áp cho cả SSR/API; `public/_headers` chỉ phủ static assets. Đã kiểm chứng trên preview workerd.
- **market/stream**: hỗ trợ `?mode=poll` (JSON snapshot). Hook `useMarketStream` tự chuyển sang poll 3s sau 2 lần SSE lỗi.
- **orderbook/scalp/chart stream**: vẫn SSE (client tự reconnect); chưa có chế độ poll — cần Durable Objects nếu muốn push bền vững.
- **Heartbeat / session-poller**: không khởi động `setInterval` trên Workers; dùng cron ngoài.
- **ADMIN_EMAILS** (tùy chọn): danh sách email được truy cập `/api/v1/system/*` và `/ops/*`; bỏ trống = mọi tài khoản đăng nhập (đăng ký đang mở).
- **CI**: `scripts/tsc-ratchet.sh` chặn tăng số lỗi TS (baseline `.tsc-baseline`); bước guard chặn file bị thay bằng placeholder.

## Nhóm ưu tiên thấp / hiệu năng (bổ sung)

- **DB trên Workers**: luôn dùng pool theo request (Hyperdrive nếu có, nếu không thì `DATABASE_URL`). Pool toàn cục bị Workers từ chối ("Cannot perform I/O on behalf of a different request") → trước đây gây lỗi 500 xen kẽ và màn hình "Có lỗi tạm thời".
- **Cache**: isolate lạnh nay đọc được bản mirror Upstash (trước đây chỉ đọc khi đã có entry trong bộ nhớ); ghi mirror/refresh nền dùng `ctx.waitUntil`.
- **HTTP provider** (`src/lib/http.ts`): gộp GET trùng đang chạy, timeout bao cả đọc body, retry 429/502/503/504 (tôn trọng Retry-After), 4xx kiểu 404 không tính vào circuit breaker.
- **MSN**: không còn khóa mặc định trong mã; đặt `MSN_FINANCE_API_KEY` nếu cần.
