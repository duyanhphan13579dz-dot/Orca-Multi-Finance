# Vietnam Derivatives — P5 Persist/Alerts + P6 Live UI

## P5

| Item | Path |
|------|------|
| Persist | `derivatives-persist.ts` → `derivative_prices` / `derivative_open_interest` |
| Alerts | `derivatives-alerts.ts` |
| Poll | `GET\|POST /api/v1/derivatives/poll` |
| Alerts API | `GET /api/v1/derivatives/alerts` |

Cron: 30–60s → `/api/v1/derivatives/poll`

## P6

| Item | Path |
|------|------|
| Dashboard | `derivatives-dashboard.tsx` (live APIs, 30s refresh) |
| Morning brief | `getDerivativesBriefBlock` |

No fabricated prices. Persist soft-fail.
