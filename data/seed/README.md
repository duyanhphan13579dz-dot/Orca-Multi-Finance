# ORCA seed / sample data

Offline fixtures for demos, backtests, and valuation pipeline tests when upstream providers are unavailable.

## Contents

| Path | Description |
| --- | --- |
| `ohlcv/VCB.json` | ~30 daily OHLCV bars (quote unit: nghìn VND) |
| `ohlcv/{SYMBOL}.json` | Bluechip seeds: HPG, FPT, VNM, MWG, TCB, MBB, BID, CTG, GAS, VHM, VIC, MSN, SSI, VPB, ACB |

Captured from VNDirect public board (`/v4/stock_prices`).

## Conventions

- **Never** treat seed files as live market data in request paths.
- Quote prices for VN equities are in **nghìn VND** (board lot), matching runtime providers.
- Dates are exchange session dates (`YYYY-MM-DD`, Vietnam).
- Volume is match volume (`nmVolume`) when sourced from VNDirect.

## Extending

Add more symbols under `ohlcv/{SYMBOL}.json` with the same schema:

```json
{
  "symbol": "VCB",
  "source": "vndirect-seed",
  "unit": "thousand_vnd",
  "bars": [{ "date": "2026-10-08", "open": 57, "high": 57.3, "low": 56.6, "close": 56.6, "volume": 2272500 }]
}
```
