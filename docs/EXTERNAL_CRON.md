# External Cron (Vercel Hobby)

Vercel **Hobby** chỉ cho phép cron **1 lần/ngày** mỗi expression.  
Lịch `*/15`, nhiều slot report/ngày → **deploy fail**.

ORCA tách scheduler khỏi host:

- **Vercel Cron** = fallback nhẹ (1 lần/ngày / path) trong `vercel.json`
- **External cron** = lịch đầy đủ (alerts 15 phút, reports multi-slot, …)

Route vẫn là:

```text
GET https://<domain>/api/v1/cron/<name>
Authorization: Bearer <CRON_SECRET>
```

(hoặc `?secret=<CRON_SECRET>` nếu provider không hỗ trợ header)

---

## 1. Biến môi trường

Trên Vercel → Project → Settings → Environment Variables:

| Key | Ghi chú |
|---|---|
| `CRON_SECRET` | Chuỗi ngẫu nhiên dài (≥ 32 ký tự). **Bắt buộc** khi mở public URL |
| `DISCORD_WEBHOOK_URL` | Cảnh báo giá + report |
| `GOOGLE_SHEETS_ID` + service account | Nếu dùng alert monitor Sheets |

Sinh secret:

```bash
openssl rand -hex 24
```

---

## 2. Khuyến nghị: cron-job.org (free)

1. Đăng ký [https://cron-job.org](https://cron-job.org)
2. Create cronjob cho từng dòng bảng dưới
3. **Request method:** `GET`
4. **Header:** `Authorization` = `Bearer <CRON_SECRET>`
5. **Timezone:** UTC (bảng dưới đã quy đổi từ giờ VN)

### Lịch đề xuất (UTC)

Giờ Việt Nam = UTC+7.

| Job | URL path | Cron (UTC) | Ý nghĩa (VN) |
|---|---|---|---|
| Alerts monitor | `/api/v1/cron/alerts` | `*/15 2-8 * * 1-5` | Mỗi 15 phút 09:00–15:45 T2–T6 |
| Alerts ATC | `/api/v1/cron/alerts` | `5 9 * * 1-5` | ~16:05 sau ATC |
| Stocks ATO | `/api/v1/cron/stocks` | `25 4 * * 1-5` | ~11:25 |
| Stocks close | `/api/v1/cron/stocks` | `25 7 * * 1-5` | ~14:25 |
| Reports morning | `/api/v1/cron/reports` | `20 1 * * 1-5` | ~08:20 brief sáng |
| Reports mid AM | `/api/v1/cron/reports` | `15 3 * * 1-5` | ~10:15 intraday |
| Reports lunch | `/api/v1/cron/reports` | `35 4 * * 1-5` | ~11:35 |
| Reports pre-ATC | `/api/v1/cron/reports` | `20 7 * * 1-5` | ~14:20 |
| Reports summary | `/api/v1/cron/reports` | `50 8 * * 1-5` | ~15:50 đóng cửa |
| Financials | `/api/v1/cron/financials` | `15 9 * * 1-5` | ~16:15 |
| Financials late | `/api/v1/cron/financials` | `30 10 * * 1-5` | ~17:30 |
| Commodities AM | `/api/v1/cron/commodities` | `0 1 * * *` | ~08:00 |
| Commodities PM | `/api/v1/cron/commodities` | `0 10 * * *` | ~17:00 |

Thay `<domain>` bằng production URL, ví dụ:

```text
https://orcamulti.vercel.app/api/v1/cron/alerts
```

### Test thủ công

```bash
export CRON_SECRET='...'   # cùng giá trị trên Vercel
export BASE='https://orcamulti.vercel.app'

curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "$BASE/api/v1/cron/alerts" | head -c 400

curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "$BASE/api/v1/cron/reports" | head -c 400
```

Kỳ vọng HTTP 200 + JSON `success: true`.  
401 → sai secret. 500 → xem Vercel Function logs.

---

## 3. Phương án khác

### GitHub Actions

`.github/workflows/cron-alerts.yml`:

```yaml
name: cron-alerts
on:
  schedule:
    - cron: "*/15 2-8 * * 1-5"
  workflow_dispatch:
jobs:
  hit:
    runs-on: ubuntu-latest
    steps:
      - name: Call alerts
        run: |
          curl -fsS -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            "${{ secrets.APP_BASE_URL }}/api/v1/cron/alerts"
```

Repo → Settings → Secrets: `CRON_SECRET`, `APP_BASE_URL`.

### Cloudflare Workers Cron

Worker schedule gọi `fetch()` tới cùng URL + header Bearer. Hữu ích nếu sau này dual-host Cloudflare.

---

## 4. Vercel.json (Hobby fallback)

Chỉ còn **một schedule / path / ngày** — deploy được trên Hobby.  
Không thay thế external cron cho alerts 15 phút và multi-slot reports.

| Path | Schedule UTC | Ghi chú |
|---|---|---|
| `/api/v1/cron/stocks` | `30 4 * * 1-5` | 1 lần/ngày phiên |
| `/api/v1/cron/commodities` | `0 1 * * *` | 1 lần/ngày |
| `/api/v1/cron/financials` | `15 9 * * 1-5` | 1 lần/ngày |
| `/api/v1/cron/reports` | `20 1 * * 1-5` | morning brief fallback |
| `/api/v1/cron/alerts` | `0 3 * * 1-5` | 1 lần mid-session |

Khi lên **Pro**, có thể khôi phục full matrix trong `vercel.json` và tắt external nếu muốn.

---

## 5. Checklist

- [ ] `CRON_SECRET` đã set trên Vercel (Production + Preview nếu cần test)
- [ ] `vercel.json` chỉ daily expressions (đã commit)
- [ ] Deploy production thành công (không lỗi Hobby cron)
- [ ] cron-job.org (hoặc GHA) đã tạo đủ job + header Bearer
- [ ] `curl` test alerts + reports trả 200
- [ ] Discord nhận alert thử (nếu có webhook)
