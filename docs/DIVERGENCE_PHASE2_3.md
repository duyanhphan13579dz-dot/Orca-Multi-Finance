# Divergence — Phase 2 (screener) + Phase 3 (alerts)

## Phase 2 — Screener

**Service:** `src/lib/services/divergence-screener.ts`

- `screenVnDivergences` — LIQUID_BOARD / custom symbols, daily OHLCV
- `screenCryptoDivergences` — Binance klines (default 1h)
- `screenMultiAssetDivergences` — merge both

**API:** `GET /api/v1/screener/divergence`

| Param | Values |
|-------|--------|
| asset | stock \| crypto \| multi |
| kind | any \| regular_bullish \| regular_bearish \| hidden_bullish \| hidden_bearish |
| oscillator | any \| rsi \| macd_hist |
| minStrength | A \| B \| C |
| timeframe | 1d (VN default) \| 1h/4h (crypto) |
| symbols | comma list |
| limit | max rows |
| recent=1 | fired cron events |

Each row: symbol, price, top DivergenceSignal, alertWorthy, summary (VI).

## Phase 3 — Alerts

- `runDivergenceAlerts()` — scan VN liquid, Class A or Class B regular, Discord notify
- Dedup: per day (Asia/Ho_Chi_Minh) key `symbol:kind:oscillator`
- Wired into `GET /api/v1/cron/alerts` alongside price + candlestick
- Recent events: `?recent=1` on screener route / in-memory ring (50)

## alertWorthy policy

- Class **A** + confidence ≥ 0.55 → alert
- Class **B** + regular (reversal) + confidence ≥ 0.55 → alert
- Hidden Class B/C → screen only (continuation noise reduction)
