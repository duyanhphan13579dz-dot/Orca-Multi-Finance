# Vietnam Derivatives — P3 History + P4 Regime & Briefs

## P3 — Quote/OI history

| Item | Path |
|------|------|
| Store | `src/lib/services/derivatives-history.ts` |
| API | `GET /api/v1/derivatives/history?symbol=VN30F1M&limit=48` |
| Behavior | Ring buffer per symbol (max 96) in process memory; snapshot/flow records samples |

ΔOI flow prefers prior from history (≥60s) when process prior is missing.

## P4 — Regime + brief integration

| Item | Path |
|------|------|
| Engine | `src/lib/engines/derivatives-regime.ts` |
| API | `GET /api/v1/derivatives/regime?underlying=VN30` |
| Brief helper | `getDerivativesBriefBlock()` |
| Wired | Intraday § Phái sinh · Market Summary § Phái sinh cuối phiên |

Regime: `risk_on_long` · `risk_off_short` · `squeeze_cover` · `liquidation` · `neutral_range` · `curve_stress` · `insufficient`

Missing quote → honest **UNAVAILABLE** (no fabrication).
