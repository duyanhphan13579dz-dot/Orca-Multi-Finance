# External Cron (cron-job.org)

**Vercel Cron đã tắt** (`vercel.json` không còn block `crons`).  
Toàn bộ lịch chạy qua **cron-job.org** (hoặc GitHub Actions / provider tương đương).

Route API vẫn dùng:

```text
GET https://<domain>/api/v1/cron/<name>
Authorization: Bearer <CRON_SECRET>
```

(hoặc `?secret=<CRON_SECRET>` nếu provider không gửi được header)

---

## 1. Biến môi trường (Vercel)

| Key | Ghi chú |
|---|---|
| `CRON_SECRET` | Chuỗi ngẫu nhiên ≥ 32 ký tự — **bắt buộc** |
| `DISCORD_WEBHOOK_URL` | Cảnh báo giá + mẫu nến + report |
| `GOOGLE_SHEETS_ID` + service account | Nếu dùng alert monitor Sheets |

```bash
openssl rand -hex 24
```

---

## 2. cron-job.org — cấu hình

1. [https://cron-job.org](https://cron-job.org) → Create cronjob
2. **Method:** `GET`
3. **URL:** `https://orcamulti.vercel.app/api/v1/cron/<name>`
4. **Header:** `Authorization` = `Bearer <CRON_SECRET>`
5. **Timezone:** UTC (bảng dưới đã quy từ giờ VN = UTC+7)
6. **Retry:** bật 1–2 lần nếu 5xx

### Lịch đề xuất (UTC)

| Job | Path | Cron (UTC) | Giờ VN (T2–T6 trừ commodities) |
|---|---|---|---|
| Alerts (intraday) | `/api/v1/cron/alerts` | `*/15 2-8 * * 1-5` | Mỗi 15′ 09:00–15:45 |
| Alerts ATC | `/api/v1/cron/alerts` | `5 9 * * 1-5` | ~16:05 sau ATC |
| Stocks ATO | `/api/v1/cron/stocks` | `25 4 * * 1-5` | ~11:25 |
| Stocks close | `/api/v1/cron/stocks` | `25 7 * * 1-5` | ~14:25 |
| Reports morning | `/api/v1/cron/reports` | `20 1 * * 1-5` | ~08:20 |
| Reports mid AM | `/api/v1/cron/reports` | `15 3 * * 1-5` | ~10:15 |
| Reports lunch | `/api/v1/cron/reports` | `35 4 * * 1-5` | ~11:35 |
| Reports pre-ATC | `/api/v1/cron/reports` | `20 7 * * 1-5` | ~14:20 |
| Reports summary | `/api/v1/cron/reports` | `50 8 * * 1-5` | ~15:50 |
| Financials | `/api/v1/cron/financials` | `15 9 * * 1-5` | ~16:15 |
| Financials late | `/api/v1/cron/financials` | `30 10 * * 1-5` | ~17:30 |
| Commodities AM | `/api/v1/cron/commodities` | `0 1 * * *` | ~08:00 hàng ngày |
| Commodities PM | `/api/v1/cron/commodities` | `0 10 * * *` | ~17:00 hàng ngày |

> `/api/v1/cron/alerts` và `/api/v1/cron/stocks` đều chạy **pattern nến đảo chiều** (Discord + store cho browser push).

### Test thủ công

```bash
export CRON_SECRET='...'
export BASE='https://orcamulti.vercel.app'

curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "$BASE/api/v1/cron/alerts" | head -c 500

curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "$BASE/api/v1/cron/stocks" | head -c 500
```

---

## 3. Ghi chú Hobby plan

- Vercel Hobby **không** cần (và **không** nên) khai báo `crons` trong `vercel.json` khi đã dùng external scheduler.
- API route vẫn `maxDuration` theo từng file; cronjob.org chỉ HTTP GET — timeout phía provider ~30–60s, route nặng (stocks/reports) nên giữ `maxDuration` đủ lớn trên Vercel.
- Region: `sin1` (Singapore) trong `vercel.json` để gần VN.
