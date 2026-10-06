# Personal Finance mode (Orca Wallet → Multi)

## Settings

`UserSettings.app.mode`: `"investment"` | `"personal_finance"`

## Routes

| Path | Role |
|------|------|
| `/pf` | Dashboard (+ pull server on mount) |
| `/pf/checkin` | Wizard → snapshot |
| `/pf/analytics` | Breakdown + history |
| `/pf/planning` | Goals + projection |
| `/pf/advice` | Rule insights |
| `/pf/report` | Printable report |
| `/pf/privacy` | Export / wipe / manual sync |

## API (W4)

- `GET /api/v1/pf` — auth required, returns `{ personalFinance, updatedAt }`
- `PUT /api/v1/pf` — body `{ personalFinance: { profile, snapshots, assumptions, goals, updatedAt } }`
- DB: `user_preferences.personal_finance` jsonb
- Migration: `drizzle/manual/003_user_personal_finance.sql`

## Client sync

- `src/lib/personal-finance/sync.ts`
- Local-first; debounced push after save; pull on `/pf` if logged in
- Conflict: last-write-wins by `updatedAt`

## Phases

- W0–W3: mode, check-in, analytics, planning, advice, report
- **W4: server sync**
- W5: portfolio bridge
