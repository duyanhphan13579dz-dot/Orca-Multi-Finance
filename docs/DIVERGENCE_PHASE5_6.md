# Divergence — Phase 5 (engine complete) + Phase 6 (confluence)

## Phase 5 — Engine complete

**Oscillators** (all deterministic, closed-bar pivots):

| Oscillator   | Series                         | Class A zone                          |
|--------------|--------------------------------|---------------------------------------|
| `rsi`        | RSI(14)                        | ≤30 bull / ≥70 bear                   |
| `macd_hist`  | MACD(12,26,9) histogram        | magnitude ratio                       |
| `macd_line`  | MACD line                      | magnitude ratio                       |
| `stoch`      | Stochastic %K(14) smooth 3     | ≤20–30 bull / ≥70–80 bear             |

**Structure** on `DivergenceSignal.structure`:

- `single` — classic 2-pivot divergence
- `double` — intermediate pivot forms same-kind legs (successive)
- `triple` — two intermediate same-kind legs

Confidence boost: +0.08 double, +0.12 triple (capped 0.95).

Default scan: all four oscillators. Screener/API `oscillator=` still filters.

Files:

- `src/lib/technical.ts` — `stochastic()`
- `src/lib/engines/divergence.ts` — Phase 5 engine
- `src/lib/types.ts` — optional `structure`
- UI filter options + labels

## Phase 6 — Multi-TF confluence

`buildDivergenceConfluence(byTf)` groups signals by `kind` across timeframes.

Returns only entries with **≥2 timeframes** (e.g. 1h + 4h both `regular_bullish`).

```ts
import { detectDivergences, buildDivergenceConfluence } from "@/lib/engines/divergence";

const legs = [
  { timeframe: "1h", signals: detectDivergences(bars1h, { timeframe: "1h" }) },
  { timeframe: "4h", signals: detectDivergences(bars4h, { timeframe: "4h" }) },
];
const confluence = buildDivergenceConfluence(legs);
```

Re-exported from `divergence-screener` for cron/agent callers.

`analyzeSeries` already surfaces divergences into TechnicalSnapshot + signals[].

## Usage

```
GET /api/v1/screener/divergence?asset=stock&oscillator=stoch&minStrength=B
GET /api/v1/screener/divergence?asset=crypto&oscillator=macd_line&timeframe=4h
/screener?universe=divergence
```
