# Cron jobs — cronjob.org (not Vercel Cron)

All scheduled work is triggered **externally** via [cronjob.org](https://cronjob.org)
(or any HTTP cron). Vercel `crons` in `vercel.json` is intentionally empty.

**Important:** many cronjob.org plans cap request timeout at **30 seconds**.
Heavy warm work is split into **phases** so each job finishes under ~25s.

## Auth

```http
Authorization: Bearer $CRON_SECRET
```

or `?secret=$CRON_SECRET`

Base URL: `https://<your-app>.vercel.app`

## Recommended schedule (Asia/Ho_Chi_Minh)

| Job | Path + query | Schedule (VN) | Timeout |
|-----|----------------|---------------|---------|
| market-live | `/api/v1/cron/market-live` | Every 1–2 min Mon–Fri 08:45–15:15 | 25–30s |
| stocks | `/api/v1/cron/stocks` | Every 5 min Mon–Fri 09:00–15:00 | 30s |
| alerts | `/api/v1/cron/alerts` | Every 10 min Mon–Fri 09:00–15:30 | 30s |
| reports | `/api/v1/cron/reports` | Session slots (morning/lunch/ATC…) | 30s |
| **Financials BCTC #1** | `/api/v1/cron/financials?phase=bctc&offset=0&limit=20` | Mon–Fri **16:10** | **30s** |
| **Financials BCTC #2** | `...?phase=bctc&offset=20&limit=20` | Mon–Fri **16:12** | **30s** |
| **Financials BCTC #3** | `...?phase=bctc&offset=40&limit=20` | Mon–Fri **16:14** | **30s** |
| **Financials OHLCV** | `...?phase=ohlcv` | Mon–Fri **16:16** | **30s** |
| **Financials CANSLIM** | `...?phase=canslim` | Mon–Fri **16:18** | **30s** |
| commodities | `/api/v1/cron/commodities` | Daily 00:05 | 30s |

Optional late backup (17:30): repeat BCTC slices if morning/afternoon failed.

### Financials phases (30s-safe)

| `phase` | Work | Notes |
|---------|------|-------|
| `bctc` | Warm fundamental packages for `offset..offset+limit` | Use limit ≤ 20–25 per job |
| `ohlcv` | Pre-warm OHLCV for CANSLIM default board (28 mã) | Fast |
| `canslim` | Seed CANSLIM result cache (UI filter score≥50 pass≥3) | After bctc+ohlcv |
| `auto` | Same as small `bctc` slice only | Default |

Example URLs:

```text
https://YOUR_DOMAIN/api/v1/cron/financials?phase=bctc&offset=0&limit=20&secret=SECRET
https://YOUR_DOMAIN/api/v1/cron/financials?phase=ohlcv&secret=SECRET
https://YOUR_DOMAIN/api/v1/cron/financials?phase=canslim&secret=SECRET
```

## CANSLIM screener (API)

- Result cache: **8 min** fresh / **30 min** SWR (memory + Redis)
- `?phase=tech` → N/S/L/M only (fast)
- `?phase=full` or default → + C/A/I when budget allows
- L (Leadership): RS = max(universe percentile, sector-peer percentile if ≥4 peers)

## Why not Vercel Cron?

- Plan limits on frequency/slots
- Cold-start coupling
- cronjob.org can stagger phase jobs every 2 minutes cleanly
