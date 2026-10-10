# Cron jobs — cronjob.org (not Cloudflare Cron Triggers)

All scheduled work is triggered **externally** via [cronjob.org](https://cronjob.org)
(or any HTTP cron). No `triggers.crons` block is declared in `wrangler.jsonc` on purpose.

**Important:** many cronjob.org plans cap request timeout at **30 seconds**.
Heavy warm work is split into **phases** so each job finishes under ~25s.

## Auth

```http
Authorization: Bearer $CRON_SECRET
```

or `?secret=$CRON_SECRET`

Base URL: `https://<your-app>.workers.dev` (or your custom domain)

## Recommended schedule (Asia/Ho_Chi_Minh)

| Job | Path + query | Schedule (VN) | Timeout |
|-----|----------------|---------------|---------|
| **board-warm** | `/api/v1/cron/board-warm` | **Every 45s** Mon–Fri 08:45–15:15 | **15s** |
| market-live | `/api/v1/cron/market-live` | Every 1–2 min Mon–Fri 08:45–15:15 | 20s |
| stocks | `/api/v1/cron/stocks` | Every 5 min Mon–Fri 09:00–15:00 | 30s |
| alerts | `/api/v1/cron/alerts` | Every 10 min Mon–Fri 09:00–15:30 | 30s |
| reports | `/api/v1/cron/reports` | Session slots (morning/lunch/ATC…) | 30s |
| **Fundamental market scan** | `/api/v1/cron/financials?phase=bctc&limit=20` | Every 1 min Mon–Fri **16:00–16:59** | **30s** |
| **Technical (Minervini) market scan** | `/api/v1/cron/financials?phase=ohlcv&limit=20` | Every 1 min Mon–Fri **17:00–17:59** | **30s** |
| **Financials CANSLIM** | `/api/v1/cron/financials?phase=canslim` | Mon–Fri **18:00** | **30s** |
| **crypto-warm** | `/api/v1/cron/crypto-warm` | **Every 60–90s** (24/7) | **15s** |
| **multi-asset-warm** | `/api/v1/cron/multi-asset-warm` | **Every 60–90s** (24/7) | **18s** |
| commodities | `/api/v1/cron/commodities` | Daily 00:05 | 30s |

Each scan URL advances its own cursor in Postgres and processes one 20-symbol slice per invocation. It returns `scanComplete=true` after all slices are done; a new Vietnam-local date starts a new cycle. The scan uses the existing `market_snapshots` table, so `DATABASE_URL` or a Cloudflare Hyperdrive binding must be configured. Without it the normal bounded live screener remains available, but there is no cross-Worker checkpoint/full-market result.

### Financials phases (30s-safe)

| `phase` | Work | Notes |
|---------|------|-------|
| `bctc` | Warm financial packages, compute Fundamental rows, checkpoint slice | Default scan uses ≤20 symbols/invocation; explicit `offset` remains supported |
| `ohlcv` | Compute Minervini/OHLCV rows and checkpoint slice across the listed-equity universe | ≤20 symbols/invocation; quotes are skipped in cron (close is used) |
| `canslim` | Seed CANSLIM result cache (UI filter score≥50 pass≥3) | After bctc+ohlcv |
| `auto` | Same as small `bctc` slice only | Default |

Example URLs:

```text
https://YOUR_DOMAIN/api/v1/cron/financials?phase=bctc&limit=20&secret=SECRET
https://YOUR_DOMAIN/api/v1/cron/financials?phase=ohlcv&limit=20&secret=SECRET
https://YOUR_DOMAIN/api/v1/cron/financials?phase=canslim&secret=SECRET
```

Do not schedule a one-shot job for only `offset=0`; it intentionally scans one bounded slice. The recommended recurring URLs above auto-select the next missing offset. Users see the previous complete snapshot while a new cycle is being assembled; incomplete data is never exposed as a full-market result. Requests with explicit `symbols=` continue to run against that requested set.


## Board pre-warm (anti-blank `/stocks`)

Keeps `last-good` board snapshot hot so the overview page never cold-starts empty
and reduces Worker 1102 on user traffic.

```text
https://YOUR_DOMAIN/api/v1/cron/board-warm?secret=SECRET
```

| Setting | Value |
|---------|--------|
| Interval | **30–60s** (recommend **45s**) during VN session |
| Outside session | every 5–10 min or off |
| Timeout | 15s |
| Work | `getVnMarketBoard()` only under `runGuarded` (no orderbook / alerts) |

`market-live` remains the 1–2 min job (heartbeat + session + board). Prefer
`board-warm` for high-frequency cache refresh; keep `stocks` at 5 min for
orderbook snapshots + pattern alerts.

## Crypto pre-warm

```text
https://YOUR_DOMAIN/api/v1/cron/crypto-warm?secret=SECRET
```

| Setting | Value |
|---------|--------|
| Interval | **60–90s** (24/7) |
| Timeout | 15s |
| Pipeline | Binance → OKX → CoinCap → CoinGecko → last-good |

## Multi-asset board (BTC · ETH · XAU · XAG · FOREX)

```text
https://YOUR_DOMAIN/api/v1/market/multi-asset
https://YOUR_DOMAIN/api/v1/market/multi-asset?symbol=XAU
https://YOUR_DOMAIN/api/v1/cron/multi-asset-warm?secret=SECRET
```

| Class | Symbols | Sources |
|-------|---------|---------|
| crypto | BTCUSDT, ETHUSDT | Binance → OKX → CoinCap → CoinGecko → Yahoo |
| metal | XAUUSD, XAGUSD | Biquote → Yahoo GC=F / SI=F |
| forex | EURUSD, GBPUSD, USDJPY, USDCHF, AUDUSD, USDCAD, NZDUSD, USDVND | Biquote → Yahoo → ER-API |

## CANSLIM screener (API)

- Result cache: **8 min** fresh / **30 min** SWR (memory + Redis)
- `?phase=tech` → N/S/L/M only (fast)
- `?phase=full` or default → + C/A/I when budget allows
- L (Leadership): RS = max(universe percentile, sector-peer percentile if ≥4 peers)

## Why not Cloudflare Cron Triggers?

- Cron Triggers invoke a `scheduled()` handler, not an HTTP route, so the existing `/api/v1/cron/*` routes would need a wrapper Worker
- Limits on the number of cron triggers per Worker
- cronjob.org can stagger phase jobs every 2 minutes cleanly
