# Personal Finance mode (Orca Wallet → Multi)

## Settings

`UserSettings.app.mode`: `"investment"` | `"personal_finance"`

## Routes

| Path | Role |
|------|------|
| `/pf` | Dashboard |
| `/pf/checkin` | Wizard → snapshot |
| `/pf/analytics` | Breakdown + history |
| `/pf/planning` | Goals + assumptions + retirement projection |
| `/pf/advice` | `generateQuantitativeAdvice` insights |
| `/pf/report` | Printable period report |
| `/pf/privacy` | Export / wipe |

## Engines (W3)

- `goalsEngine.evaluateGoals`
- `projectionEngine.runFinancialProjection` (deterministic)
- `adviceEngine.generateQuantitativeAdvice` (rule-based 6-part)

## Phases

- W0–W2: mode, check-in, analytics, privacy
- **W3: planning, advice engine, report**
- W4: server sync
- W5: portfolio bridge
