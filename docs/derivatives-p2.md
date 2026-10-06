# Vietnam Derivatives — P2 Term Structure & Margin

## Scope

| Feature | Path |
|---------|------|
| Curve engine | `src/lib/engines/derivatives-curve.ts` |
| Margin schedule | `src/lib/providers/vsdc-spec.ts` → `MARGIN_SCHEDULE` |
| Service | `getDerivativesTermStructure`, `getMarginSchedule`, `getContractMarginEstimate` |
| API | `GET /api/v1/derivatives/curve?underlying=VN30` |
| | `GET /api/v1/derivatives/margin?productId=VN30_INDEX_FUT` |
| | `GET /api/v1/derivatives/margin?symbol=VN30F1M&last=1300` |

## Curve semantics

- Points sorted by `daysToExpiry` (else continuous priority).
- Calendar spread = **near − far** (index points).
- **Contango**: far > near (spread negative).
- **Backwardation**: near > far (spread positive).
- Roll yield annualized only when both lasts + DTE known.

## Margin

- Indicative rates only (`initialMarginRate` ≈ 13% VN30 seed).
- Always show `source` + `effectiveFrom` + note — not for live clearing without VSDC feed.

## Data honesty

No fabricated futures prices. Empty quote → null legs → `shape: insufficient` / `partial: true`.
