# Personal Finance mode (Orca Wallet → Multi)

## Settings

`UserSettings.app.mode`: `"investment"` | `"personal_finance"`

Settings → Hồ sơ → **Chế độ ứng dụng**

## Routes

| Path | Role |
|------|------|
| `/pf` | Dashboard metrics |
| `/pf/checkin` | Multi-step wizard → snapshot (tax, cashflow, health) |
| `/pf/analytics` | Breakdown + history |
| `/pf/planning` | Placeholder (W3 goals/projection) |
| `/pf/advice` | Rule-based tips from latest metrics |
| `/pf/report` | Placeholder |
| `/pf/privacy` | Export JSON / wipe local data |

## Lib

- `build-snapshot.ts` — compose MonthlySnapshot from check-in
- engines: taxVn, cashflow, networth, healthScore
- storage: localStorage `orca_fin_*`

## Phases

- W0–W1: mode + shell + types + engines skeleton
- **W2: check-in + analytics + advice + privacy**
- W3: planning/goals UI, full advice engine rules
- W4: server sync `/api/v1/pf/*`
- W5: bridge portfolio Multi ↔ PF assets
