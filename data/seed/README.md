# ORCA seed / sample data

Offline fixtures for demos, backtests, and valuation pipeline tests when upstream providers are unavailable.

## Contents

| Path | Description |
| --- | --- |
| `ohlcv/VCB.json` | HOSE bluechip (~30 daily bars) |
| `ohlcv/{SYMBOL}.json` | HOSE bluechips: HPG, FPT, VNM, MWG, TCB, MBB, BID, CTG, GAS, VHM, VIC, MSN, SSI, VPB, ACB |
| `ohlcv/CEO.json`, `PVS.json`, `CST.json`, `IDC.json` | **HNX** samples |
| `ohlcv/BSR.json`, `OIL.json` | **UPCOM** samples |
| `ohlcv/SHB.json`, `VGI.json` | Cross-floor samples |

Captured from VNDirect public board (`/v4/stock_prices`).

**Runtime OHLCV** for *all* HOSE / HNX / UPCOM listings (not only seeds):

- `GET /api/v1/stocks/universe?exchange=HOSE|HNX|UPCOM|ALL`
- `GET /api/v1/chart/history?symbol={SYMBOL}&assetType=stock&timeframe=1d`
- Cascade: `vndirect-dchart` ∥ `stock_prices` ∥ public (VPS/Entrade) ∥ SSI fcdata

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
