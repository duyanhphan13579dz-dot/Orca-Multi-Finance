# Personal Finance mode (Orca Wallet → Multi)

## Settings

`UserSettings.app.mode`: `"investment"` | `"personal_finance"`

Settings → Hồ sơ → **Chế độ ứng dụng**

## Routes

| Path | Role |
|------|------|
| `/pf` | Dashboard + metrics when snapshots exist |
| `/pf/checkin` | Check-in (UI W2+) |
| `/pf/analytics` | Analytics |
| `/pf/planning` | Goals / projection |
| `/pf/advice` | Advice engine |
| `/pf/report` | Report |
| `/pf/privacy` | Privacy |

## Lib

`src/lib/personal-finance/` — types, storage (localStorage), engines ported from Orca-Wallet.

## Sidebar

`shell-inner.tsx` switches nav by `settings.app.mode`.
