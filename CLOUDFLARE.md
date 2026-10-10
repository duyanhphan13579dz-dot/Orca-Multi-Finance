# Deploy ORCA lên Cloudflare Workers

Dự án này là bản sao của `Orca-Multi-Finance`, mã nguồn giữ nguyên; chỉ thay phần hosting
**Vercel / Netlify → Cloudflare Workers** (adapter [OpenNext](https://opennext.js.org/cloudflare)).

## 1. Deploy nhanh

```bash
pnpm install --frozen-lockfile
pnpm exec wrangler login                 # đăng nhập Cloudflare
pnpm exec wrangler secret put JWT_SECRET # lặp lại cho từng secret (mục 2)
pnpm deploy                              # = opennextjs-cloudflare build && deploy
```

Chạy thử cục bộ trong runtime Workers: sao chép `.dev.vars.example` → `.dev.vars`, điền giá trị, rồi `pnpm preview`.

**Deploy tự động từ Git (Workers Builds):** Build command `npx opennextjs-cloudflare build`,
Deploy command `npx opennextjs-cloudflare deploy`. Khai báo biến `NEXT_PUBLIC_*` trong phần
Build variables vì chúng được nhúng lúc build.

## 2. Biến môi trường

- **Secrets** (`wrangler secret put <KEY>` hoặc Dashboard → Variables and Secrets): `DATABASE_URL`, `JWT_SECRET`,
  `CRON_SECRET`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `SSI_*`, `BINANCE_API_KEY`, … (danh sách đầy đủ ở `.env.example`).
- **Vars không nhạy cảm**: khai báo trong `wrangler.jsonc` → `vars`. Đã có `CLOUDFLARE_WORKERS=1`
  (thay cho `VERCEL=1`: `ws-policy` mặc định TẮT WebSocket) và `NEXT_TELEMETRY_DISABLED=1`.
- **`NEXT_PUBLIC_SITE_URL`**: đặt thành domain thật (lúc build). Nếu bỏ trống, metadata/OG và link Discord dùng
  `https://orca-multi-finance.workers.dev` làm giá trị dự phòng.

## 3. Những gì đã thay đổi so với dự án gốc

| Gốc | Bản Cloudflare |
|---|---|
| `vercel.json` (region `sin1`) | `wrangler.jsonc` (`placement.mode = "smart"`) |
| `netlify.toml` + `@netlify/plugin-nextjs` | `open-next.config.ts`, `public/_headers` |
| `process.env.VERCEL === "1"` trong `ws-policy.ts` | `process.env.CLOUDFLARE_WORKERS === "1"` |
| `VERCEL_URL`, domain `*.vercel.app` cứng trong mã | `NEXT_PUBLIC_SITE_URL` + domain dự phòng `workers.dev` |
| `export const runtime = "edge"` ở `icon`, `apple-icon`, `opengraph-image` | đã bỏ (OpenNext chạy mọi route ở runtime Node-compat) |
| `next.config.ts` | thêm `initOpenNextCloudflareForDev()` và `outputFileTracingIncludes` cho `pg-cloudflare` |
| `optionalDependencies.playwright` | đã bỏ (Chromium không chạy được trên Workers; xem mục 5) |
| — | thêm `@opennextjs/cloudflare@1.20.1`, `wrangler`, scripts `preview` / `deploy` / `upload` / `cf-typegen` |

## 4. Lưu ý quan trọng khi vận hành

- **Gói Workers:** nên dùng **Workers Paid**. Gói Free giới hạn CPU **10 ms/request** và **50 subrequest/request**;
  các route tổng hợp dữ liệu, đăng nhập (scrypt) và screener sẽ vượt mức này. Kích thước Worker hiện ~19,5 MiB chưa nén
  (giới hạn 64 MiB).
- **`maxDuration` trong từng route không còn tác dụng** trên Workers. Cron vẫn chạy ngoài qua cron-job.org
  (xem `docs/EXTERNAL_CRON.md`), giữ nguyên cách chia phase.
- **Realtime:** WebSocket/SSE dài hạn và state trong bộ nhớ (cache, heartbeat, scheduler) chỉ tồn tại trong một isolate,
  không chia sẻ giữa các isolate. App tự fallback về REST/polling như trên serverless trước đây.
- **Phiên bản:** `@opennextjs/cloudflare` được ghim ở `1.20.1`, bản mới nhất còn hỗ trợ Next `16.2.6`.
  Bản adapter mới hơn yêu cầu Next `>=16.3.8`; khi nâng Next hãy nâng adapter cùng lúc.

## 5. Chưa kiểm chứng (cần thử trên môi trường thật)

- **PostgreSQL:** `src/db/index.ts` giữ một `pg.Pool` toàn cục dùng lại giữa các request. Trên Workers, socket TCP
  tạo ở request này thường không dùng lại được ở request khác ("Cannot perform I/O on behalf of a different request").
  Nếu gặp lỗi, dùng **Hyperdrive** (có sẵn mẫu `hyperdrive` đã comment trong `wrangler.jsonc`) và tạo client theo từng
  request, hoặc dùng driver HTTP/serverless. Bản này **chưa được thử với database thật**; không có `DATABASE_URL` thì
  app dùng mock như bản gốc.
- **Redis (`ioredis`):** tuỳ chọn; nếu kết nối thất bại, `src/lib/cache.ts` tự dùng cache bộ nhớ.
- **Dữ liệu thị trường thật:** các nhà cung cấp (VNDirect, SSI, VietnamBiz, …) chưa được gọi thử vì môi trường kiểm tra
  không có mạng ra ngoài.
- **SSC headless crawler (Playwright):** không chạy được trên Workers. Cần dùng thì chạy cục bộ:
  `pnpm add -D playwright && pnpm ssc:install-browser && pnpm ssc:crawl`.

## 6. Bảo mật — bắt buộc trước khi chạy production

- **`JWT_SECRET` là bắt buộc** (>= 32 ký tự, `openssl rand -hex 32`). Thiếu hoặc quá ngắn thì đăng nhập/đăng ký trả lỗi 500
  thay vì ký bằng khóa mặc định như trước. Ở `next dev` vẫn có khóa cục bộ để chạy thử.
- **`CRON_SECRET` là bắt buộc** (`openssl rand -hex 24`). Thiếu thì mọi route `/api/v1/cron/*` trả 503 ở production.
  Có secret thì gọi bằng `Authorization: Bearer <secret>` hoặc `?secret=<secret>`.
- **Rate limit** theo IP (`src/lib/rate-limit.ts`, khai báo `ratelimits` trong `wrangler.jsonc`):
  `RL_AI` cho `/agent`, `/journal/analyze`, `/backtest` và `RL_AUTH` cho `/auth/login`, `/auth/register`, mỗi nhóm 10 lần / 60 giây.
  Binding giới hạn theo từng datacenter và nhất quán dần, không phải bộ đếm chính xác. Muốn chặt hơn, thêm quy tắc
  Rate Limiting trong Cloudflare Dashboard → Security → WAF. `namespace_id` (71001, 71002) phải duy nhất trong tài khoản Cloudflare.
