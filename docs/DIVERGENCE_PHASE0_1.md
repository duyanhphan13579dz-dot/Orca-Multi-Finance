# Divergence — Phase 0 (contract) + Phase 1 (engine)

## Phase 0 — Data contract

Shared types in `src/lib/types.ts`:

- `DivergenceKind`: `regular_bullish` | `regular_bearish` | `hidden_bullish` | `hidden_bearish`
- `DivergenceOscillator`: `rsi` | `macd_hist` | `macd_line` | `stoch` (Phase 1 uses rsi + macd_hist)
- `DivergenceStrength`: `A` | `B` | `C`
- `DivergencePivot`, `DivergenceSignal`
- `TechnicalSnapshot.divergences?: DivergenceSignal[]`

Rules:

- Quant-only (no LLM arithmetic).
- Confirmed pivots only (full left/right fractal window on **closed** bars).
- Callers attach API `meta` (source / freshness) at the HTTP boundary.

## Phase 1 — Engine

File: `src/lib/engines/divergence.ts`

- `detectDivergences(bars, opts)` → `DivergenceSignal[]`
- Oscillators: RSI(14), MACD histogram (12/26/9)
- Default pivot window 5/5, lookback 120, min/max bars between pivots 5–60
- Wired into `analyzeSeries()` → snapshot + up to 3 human-readable `signals[]` lines (VI)

## Next (not in this commit)

- Phase 2: screener filters
- Phase 3: alert types + watchlist polling
- Chart overlay, multi-TF labels from callers

## Tests

`src/lib/__tests__/divergence.test.ts`
