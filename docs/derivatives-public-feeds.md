# Public feeds — VN derivatives & global commodities

## Vietnam index futures (no API key)

| Source | Endpoint | Data |
|--------|----------|------|
| **VNDIRECT dchart** | `https://dchart-api.vndirect.com.vn/dchart/history` | OHLCV continuous `VN30F1M/2M/3M/1Q`, VN30 spot |
| Priority | SSI FastConnect → `DERIVATIVES_QUOTE_URL` → **public dchart** | |

- Last daily bar → `last` / volume / change vs prior bar
- **OI not available** on public dchart (`null` until SSI/paid)
- Delayed / public — not exchange co-location live

## Global commodities (no API key)

| Source | Endpoint | Symbols |
|--------|----------|---------|
| **Yahoo Finance** | `query1.finance.yahoo.com/v8/finance/chart/{SYM}=F` | GC, SI, HG, CL, BZ, NG, ZC, ZW, ES |

API: `GET /api/v1/commodities`

## Paid / better OI (optional)

- SSI FastConnect Data `Market=DER` + credentials
- `DERIVATIVES_QUOTE_URL` custom mirror
