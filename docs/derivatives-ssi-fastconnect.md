# SSI FastConnect — Derivatives real-time

## Credentials

```bash
SSI_FC_CONSUMER_ID=...
SSI_FC_CONSUMER_SECRET=...
# aliases: SSI_API_KEY / SSI_API_SECRET
# optional: SSI_FC_DATA_BASE_URL=https://fc-data.ssi.com.vn
```

Register: https://guide.ssi.com.vn/ssi-products/fastconnect-data

## Flow

1. `POST /api/v2/Market/AccessToken`
2. `GET /api/v2/Market/Securities?market=DER` → map `VN30F1M` → listed `VN30FyyMM`
3. `GET /api/v2/Market/DailyStockPrice?market=DER` → last / OI / volume
4. `GET /api/v2/Market/DailyOhlc` → history

Module: `src/lib/providers/ssi-derivatives.ts`  
Cascade: **SSI DER → external URL → VNDIRECT public**

## Health

```http
GET /api/v1/derivatives/ssi-status
```
