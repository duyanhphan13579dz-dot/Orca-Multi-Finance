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
