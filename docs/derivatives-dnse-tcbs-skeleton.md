# DNSE + TCBS derivatives skeletons

Env-gated brokers **after SSI**, **before** public Entrade/VNDIRECT.

## Cascade

```
SSI → DNSE → TCBS → Entrade public → external URL → VNDIRECT
```

## DNSE

```bash
DNSE_API_KEY=
DNSE_API_SECRET=
DNSE_BEARER_TOKEN=          # optional test token
DNSE_OPENAPI_BASE_URL=https://openapi.dnse.com.vn
```

Module: `src/lib/providers/dnse-derivatives.ts`  
TODO: full HMAC from openapi-sdk.

## TCBS

```bash
TCBS_ACCESS_TOKEN=          # preferred
TCBS_API_KEY=               # else exchange JWT
TCBS_OPENAPI_BASE_URL=https://openapi.tcbs.com.vn
```

Module: `src/lib/providers/tcbs-derivatives.ts`  
Docs: https://developers.tcbs.com.vn/

## Health

```http
GET /api/v1/derivatives/feeds-status
```
