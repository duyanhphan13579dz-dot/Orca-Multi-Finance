# Market-wide screener performance and resilience review — 2026-10-10

## Summary

Implemented bounded, resumable market-wide scanning for **Fundamental** and **Minervini Technical** without requiring one request to scan the whole Vietnamese listed universe. Cron invocations process one slice (default 20 symbols); completed slices are checkpointed in the existing `market_snapshots` table. The API serves a full-market result only after every slice for that daily cycle is stored. Until then, the previous complete snapshot remains available; if there is no complete snapshot, the existing bounded live scan remains the fallback.

## Findings and changes

1. **Synchronous universe fan-out risked Worker timeouts.** Fundamental and OHLCV providers can be slow or degraded, and user requests should not perform hundreds of symbol-level fetches.
   - Added independent daily cursors for Fundamental and Minervini cron work.
   - Each invocation scans one bounded slice; the cursor retries a slice if it was not checkpointed.
   - Full snapshots are published atomically at the manifest level only after all expected offsets are present. Custom `symbols=` cron calls cannot publish a subset as the market universe.
   - Fundamental API filters and Minervini filters operate on the assembled full-market result when available.

2. **OHLCV scan repeated provider work after a slow primary cascade.** `getVnOhlcv` already attempts its provider chain, but the batch layer could then call a second resilient chain for the same symbol.
   - Removed the duplicate second cascade from the screener batch path.
   - Added real `AbortSignal` propagation through the shared HTTP client and public OHLCV/VNDirect DChart adapter; a per-symbol timeout now aborts outbound requests rather than only racing the response promise.
   - Capped OHLCV batch deadlines below the screener Worker wall-time budget and stopped starting symbols after the deadline.
   - Increased same-isolate daily OHLCV cache to five minutes; quotes remain fetched separately where a live price is needed.

3. **Fundamental snapshot assembly performed cache reads serially.**
   - Snapshot-cache reads now run in bounded parallelism (at most four), preserving order and limiting downstream pressure.
   - Interactive screener requests no longer repeat persistence writes that belong in scheduled warm jobs.

4. **Pages had no last-good response when the request pipeline failed.**
   - Added last-good hot slots for the default Fundamental and Minervini views. When configured, the existing Upstash layer shares these across Worker isolates; an in-memory fallback covers the current isolate.
   - Only the default view is reused on a failure, so a previous user's custom filter/list is never shown for another query. Fallback metadata explicitly marks the response stale/partial.

5. **Minervini relative-strength rank was calculated within each slice.**
   - Cron stores the per-symbol technical metrics, then the API recalculates proxy RS rank across the combined market snapshot before applying `minRs` and ranking results.

## Required scheduled jobs

Configure two recurring requests in the existing cron system, weekdays in Vietnam time:

| URL path | Cadence/window | Purpose |
|---|---|---|
| `/api/v1/cron/financials?phase=bctc&limit=20` | Every minute, 16:00–16:59 Asia/Ho_Chi_Minh | Warm financial packages and checkpoint Fundamental rows |
| `/api/v1/cron/financials?phase=ohlcv&limit=20` | Every minute, 17:00–17:59 Asia/Ho_Chi_Minh | Compute and checkpoint Minervini/OHLCV rows |

Keep the configured cron secret out of source control and attach it using the existing cron provider's secure header/query-secret setting. No `offset` is needed: each phase chooses the next missing slice and stops with `scanComplete=true` after a complete daily cycle. `limit` can be set from 10 to 30; use 20 as the conservative default. If the universe is larger than 600 listings, adjust the existing universe cap and allow proportionally more invocations.

`DATABASE_URL` or the configured Cloudflare database binding must be available to the deployed Worker. The implementation deliberately uses the pre-existing `market_snapshots` schema and requires no new migration. If database storage is unavailable, slice checkpoints cannot be shared between Workers: the API remains functional via the bounded live path but cannot publish a full-market snapshot.

## Validation

- `npm test`: **35 passed, 0 failed**.
- ESLint on all changed TypeScript modules: **passed**.
- `git diff --check`: **passed**.
- `npm run typecheck`: still reports **108 project errors in unrelated/pre-existing modules**; none of the changed files appears in the final error list. This project-wide typecheck is not currently clean, so it should not be represented as a clean build.

## Operational notes and limits

- The full-market cycle is a cached daily scan, not an intraday quote feed. Minervini cron deliberately skips quote fan-out and uses the latest OHLCV close to keep slices fast; live price fields are consequently not guaranteed to reflect a just-opened market. The regular live screener and quote APIs remain available for intraday prices.
- A complete snapshot is usable for up to 72 hours; metadata marks it stale after 24 hours. This allows weekend continuity without presenting it as fresh.
- Other technical screener methods continue to use their existing bounded universes. This change adds full-market coverage specifically to Fundamental and Minervini while making their shared OHLCV fetch path more deadline-safe.
- Cron configuration was documented but not provisioned in the external scheduler by this code change. The full-market snapshot will start refreshing once the two recurring jobs are enabled.
