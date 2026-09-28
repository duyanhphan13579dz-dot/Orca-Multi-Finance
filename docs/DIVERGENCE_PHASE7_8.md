# Divergence — Phase 7 (product quant wiring) + Phase 8 (hardening)

## Phase 7 — Quant product wiring

### Stock tech reco
`computeStockTechReco` consumes `tech.divergences`:

| Kind | Base weight | Class A | double/triple |
|------|-------------|---------|---------------|
| regular bullish | +14 | +18 | ×1.25 |
| regular bearish | −14 | −18 | ×1.25 |
| hidden bullish | +8 | +10 | — |
| hidden bearish | −8 | −10 | — |

Weight scaled by `confidence`. Appears as factor key `divergence`.

### Alerts (Phase 8 policy shared)
- Class A ≥ conf floor → alert
- Class B regular ≥ conf floor → alert
- conf floor = 0.50 if double/triple else 0.55
- Class B + multi-structure ≥ 0.60 → alert (continuation surface)

## Phase 8 — Hardening

- Chart markers title includes structure when not single
- Technical panel: Stoch / MACD line labels + structure badge
- API engine string → Phase 5–8
- Unit tests: stoch/macd_line, confluence ≥2 TF, structure contract
- Screener filter already accepts all oscillators (Phase 5)

## Full roadmap status (audit)

| Phase | Scope | Status |
|-------|-------|--------|
| 0 | Types + contract | Done |
| 1 | Engine RSI + MACD hist | Done → expanded in 5 |
| 2 | Screener service + API | Done |
| 3 | Cron Discord alerts + dedup | Done |
| 4 | UI tab + technical panel + chart markers | Done |
| 5 | Stoch, MACD line, structure | Done |
| 6 | buildDivergenceConfluence | Done |
| 7 | Tech-reco quant factor | Done |
| 8 | Alert policy, markers, tests, docs | Done |

### Known constraints (not bugs)
- VN stock OHLCV in chart-history simplified path is daily-centric (`getVnOhlcv`)
- Confluence helper is caller-driven (agent/cron); no separate `/confluence` HTTP route yet
- Forming (unconfirmed) pivots intentionally off

### Verify
```
/screener?universe=divergence
GET /api/v1/screener/divergence?oscillator=stoch&minStrength=B
GET /api/v1/cron/alerts  (includes divergences)
Open stock page → technical panel Phân kỳ + chart markers
```
