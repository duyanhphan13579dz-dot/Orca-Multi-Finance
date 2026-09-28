# Divergence — Phase 4 (UI + chart markers)

## Screener UI

- Component: `src/components/divergence-screener.tsx`
- Tab **Phân kỳ** on `/screener?universe=divergence`
- Filters: asset (stock/crypto/multi), kind, oscillator, minStrength, alert-only
- Calls `GET /api/v1/screener/divergence`

## Technical panel

- `TechnicalPanel` renders `tech.divergences` (from `analyzeSeries`) under section **Phân kỳ**

## Chart markers

- `SignalType`: `divergence-bull` | `divergence-bear`
- `computeMarkers` in `src/lib/services/chart.ts` attaches divergence markers from confirmed pivots
- Client `src/chart/markers.ts` + `theme.ts` style circles (green below / red above)

## Usage

```
/screener?universe=divergence
```

Open stock/crypto chart — markers appear at second pivot of each divergence when history is loaded.
