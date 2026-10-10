# ORCA Multi-Finance — Test & Build Baseline (Phase 1)

**Thời điểm kiểm toán:** 2026-10-10  
**Môi trường:** Windows x64 · Node.js `v24.18.1` · npm `12.0.2`  
**Git Commit SHA:** `4ef30a9af68447bb428037fa9964b26f9f9d33af`  
**Nhánh:** `main` (up to date với `origin/main`)  
**Repository:** `https://github.com/duyanhphan13579dz-dot/Orca-Multi-FN.git`  

---

## 1. Tóm tắt kết quả lệnh thực thi

| Lệnh | Trạng thái | Thời gian thực thi | Kết quả chi tiết |
|---|:---:|:---:|---|
| `npm run typecheck` | **PASS** | ~4.5s | `tsc --noEmit` hoàn tất không có lỗi nào |
| `npm run lint` | **PASS** | ~17s | `eslint .` hoàn tất không có lỗi |
| `npm run check:sources` | **PASS** | ~9s | 32/32 nguồn HTTP probe trả về `ONLINE` (100%) |
| `npm test` (khai báo trong package.json) | **PASS** | ~2.4s | 16 test files chạy: 50 tests pass, 0 fail |
| Chạy toàn bộ test suite (bao gồm omitted tests) | **FAIL** | ~4.7s | 25 test files: 98 pass, 4 fail (3 ở `portfolio`, 1 ở `chat-message`) |
| `npm run build` | **PASS** | ~55s | Next.js 16 (Turbopack) build thành công 27 static routes, 120+ dynamic API routes |

---

## 2. Chi tiết thực thi Test Suite

### 2.1. Bộ test mặc định trong `npm test` (`package.json`)
```bash
node --import tsx --import ./test/test-setup/register-stub.mjs --require ./test/test-setup/patch-server-only.cjs --test \
  src/lib/__tests__/canslim-engine.test.ts \
  src/lib/__tests__/chart-engine.test.ts \
  src/lib/__tests__/divergence.test.ts \
  src/lib/__tests__/candlestick-patterns.test.ts \
  src/lib/__tests__/fundamental-ratio-regressions.test.ts \
  src/lib/__tests__/valuation-phase1.test.ts \
  src/lib/__tests__/valuation-phase2.test.ts \
  src/lib/__tests__/valuation-phase3.test.ts \
  src/lib/__tests__/valuation-phase4.test.ts \
  src/lib/__tests__/valuation-phase5.test.ts \
  src/lib/__tests__/valuation-phase6.test.ts \
  src/lib/__tests__/valuation-pipeline.test.ts \
  src/lib/__tests__/http-cache.test.ts \
  src/lib/__tests__/cron-auth.test.ts \
  src/lib/__tests__/vnb-goods.test.ts \
  src/lib/__tests__/vnd-news.test.ts
```
**Kết quả:**
- 16 files chạy.
- 50 passed, 0 failed, 0 skipped.
- Thời gian chạy: 2,363 ms.

### 2.2. Các file test bị bỏ sót trong `npm test` và CI
Các file test tồn tại trong mã nguồn nhưng **không** được đưa vào `npm test` hoặc `.github/workflows/ci.yml`:

1. `src/lib/__tests__/portfolio.test.ts` (**FAIL - 3 lỗi**)
   - `buildPortfolioSnapshot computes open exposure, unrealized pnl and allocation`: `19.58 !== 20`
   - `buildPortfolioSnapshot measures closed performance and drawdown`: `19.180000000000003 !== 20`
   - `stock marks from source feed portfolio status and asset status`: `204375 !== 250000`
   - *Nguyên nhân:* Do `pnl()` trong `src/lib/portfolio.ts` bổ sung `tradeFeesValue()`, tự động trừ phí giao dịch biến gross PnL thành net PnL, khiến các assert PnL gộp cũ bị trượt. Thay vì cập nhật test hoặc hỗ trợ cả gross/net, tác giả trước đã bỏ file này ra khỏi `npm test`.

2. `src/components/agent/__tests__/chat-message.test.tsx` (**FAIL - 1 lỗi**)
   - `answer text is never emitted as raw HTML`: `AssertionError: The input did not match the regular expression /<img/`
   - *Nguyên nhân:* Dòng 40 kiểm tra `assert.ok(!html.includes("<img"))` nhưng dòng 41 lại viết `assert.match(html, /<img/)` (mâu thuẫn trực tiếp). Đúng ra phải kiểm tra ký tự HTML entity escaped `assert.match(html, /&lt;img/)`. File bị bỏ ra ngoài test script.

3. `src/lib/__tests__/money-flow.test.ts` (**PASS - 8 tests**)
   - Hoàn tất trong ~25ms. Hoạt động tốt nhưng chưa được khai báo trong CI.

4. `src/lib/__tests__/mtf-bias.test.ts` (**PASS - 3 tests**)
   - Hoàn tất trong ~11ms. Hoạt động tốt nhưng chưa được khai báo trong CI.

5. `src/lib/ai/__tests__/chat-format.test.ts` (**PASS - 14 tests**)
   - Hoàn tất trong ~15ms. Hoạt động tốt.

6. `src/lib/ai/__tests__/chat-store.test.ts` (**PASS - 6 tests**)
   - Hoàn tất trong ~610ms. Hoạt động tốt.

7. `src/lib/services/__tests__/stock-summary.test.ts` (**PASS - 5 tests**)
   - Hoàn tất trong ~55ms. Hoạt động tốt.

8. `src/features/personal-finance/engines/__tests__/engineTests.ts` (**PASS - 1 suite**)
   - Hoàn tất trong ~410ms. Hoạt động tốt.

9. `test/agent-router-smoke.ts` (**PASS - 8 kịch bản**)
   - Smoke test router cho AI hoàn tất thành công.

---

## 3. Đối chiếu CI Pipeline (`.github/workflows/ci.yml`)

Workflow CI hiện tại trên GitHub Actions:
```yaml
test:
  runs-on: ubuntu-latest
  steps:
    - run: pnpm exec node --import tsx --import ./test/test-setup/register-stub.mjs --require ./test/test-setup/patch-server-only.cjs --test \
        src/lib/__tests__/chart-engine.test.ts \
        src/lib/__tests__/divergence.test.ts \
        src/lib/__tests__/candlestick-patterns.test.ts \
        src/lib/__tests__/valuation-phase1.test.ts \
        src/lib/__tests__/valuation-phase2.test.ts \
        src/lib/__tests__/valuation-phase3.test.ts \
        src/lib/__tests__/valuation-phase4.test.ts \
        src/lib/__tests__/valuation-phase5.test.ts \
        src/lib/__tests__/valuation-phase6.test.ts \
        src/lib/__tests__/valuation-pipeline.test.ts
```
**Nhận xét:**
CI chỉ chạy 10 files valuation & chart, bỏ qua:
- `canslim-engine.test.ts`
- `fundamental-ratio-regressions.test.ts`
- `http-cache.test.ts`
- `cron-auth.test.ts`
- `vnb-goods.test.ts`
- `vnd-news.test.ts`
- `money-flow.test.ts`
- `mtf-bias.test.ts`
- `portfolio.test.ts` (đang fail)
- `chat-format.test.ts`
- `chat-store.test.ts`
- `stock-summary.test.ts`
- `chat-message.test.tsx` (đang fail)

**Đánh giá:** Pipeline CI tạo ảo giác "xanh" bằng cách loại trừ các file lỗi và chỉ chạy ~40% tổng số test files hiện có.

---

## 4. Baseline Production Build (`next build`)
- Framework: Next.js 16.3.8 (Turbopack)
- Thời gian biên dịch Next.js: ~24.8s
- Thời gian kiểm tra TypeScript nội bộ: ~26.5s
- Tạo trang tĩnh: 27/27 static routes (1,084 ms)
- Tổng thời gian: ~55s
- Kết quả: Không có lỗi biên dịch.
