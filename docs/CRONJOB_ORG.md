# Cron jobs — cronjob.org (not Vercel Cron)

All scheduled work is triggered **externally** via [cronjob.org](https://cronjob.org)
(or any HTTP cron). Vercel `crons` in `vercel.json` is intentionally empty so
Pro/Hobby limits and cold-start coupling do not affect the app.

## Auth

Every endpoint requires one of:

```http
Authorization: Bearer $CRON_SECRET
```

or

```text
?secret=$CRON_SECRET
```

Set `CRON_SECRET` in Vercel env and in each cronjob.org job URL/header.

Base URL example: `https://<your-app>.vercel.app`

## Recommended schedule (Asia/Ho_Chi_Minh)

cronjob.org uses your chosen timezone — set **Asia/Ho_Chi_Minh**.

| Job | Path | Schedule (VN) | Notes |
|-----|------|---------------|-------|
| market-live | `GET /api/v1/cron/market-live` | Every **1–2 min** Mon–Fri 08:45–15:15 | Warm board + indices; `maxDuration=25` |
| stocks | `GET /api/v1/cron/stocks` | Every **5 min** Mon–Fri 09:00–15:00 | Board + SSI order-book snapshot; `maxDuration=30` |
| alerts | `GET /api/v1/cron/alerts` | Every **10 min** Mon–Fri 09:00–15:30 | Price alerts + candlestick + divergence; `maxDuration=60` |
| reports | `GET /api/v1/cron/reports` | Every **30 min** Mon–Fri 08:00–17:00 | Session-aware morning/intraday/summary; `maxDuration=60` |
| financials | `GET /api/v1/cron/financials` | **Once** Mon–Fri **15:30** | Warm BCTC after ATC; `maxDuration=60` |
| commodities | `GET /api/v1/cron/commodities` | **Daily 00:05** | Commodity refresh; `maxDuration=60` |

Outside session, market-live / stocks can be slowed to every 30–120 min or disabled.

## Example cronjob.org URL

```text
https://YOUR_DOMAIN/api/v1/cron/market-live?secret=YOUR_CRON_SECRET
```

Request method: **GET**. Enable “Save response” for debugging. Timeout ≥ 60s for alerts/reports/financials.

## Why not Vercel Cron?

- Hobby plan: limited cron slots and frequency
- Couples deploy region cold-starts to schedule
- Harder to pause one pipeline without redeploy
- cronjob.org can hit different paths at different cadences and timezones cleanly

Routes under `/api/v1/cron/*` remain public HTTP endpoints (secret-protected) so any external scheduler works.
