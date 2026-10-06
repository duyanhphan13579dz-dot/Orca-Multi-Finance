# Parallel derivatives sources (alongside SSI FastConnect)

## Cascade (code)

```
1. SSI FastConnect DER     (credentials)  — session + OI when present
2. Entrade/DNSE chart      (public)       — 5m/1D OHLCV
3. DERIVATIVES_QUOTE_URL   (optional)
4. VNDIRECT dchart         (public)       — daily continuous
```

## VN matrix

| Source | Auth | Latency | OI | Notes |
|--------|------|---------|-----|-------|
| **SSI FastConnect** | Consumer ID/Secret | Session REST | Yes if field | Primary |
| **Entrade chart** | None | 5m bars | No | services.entrade.com.vn |
| **VNDIRECT dchart** | None | EOD/delayed | No | Continuous VN30F1M… |
| DNSE OpenAPI | API key | WS+REST | Yes | Needs DNSE account |
| TCBS OpenAPI | API key+JWT | Market DER | Yes | Trading API |
| SSI iboard | — | — | — | WAF blocked |

## International

Yahoo Finance (no key): GC SI HG CL BZ NG ZC ZW ES → `GET /api/v1/commodities`

## Ops

- Keep Entrade + VNDIRECT always on so UI is never empty when SSI is down.
- Enable SSI for OI / session accuracy.
- DNSE/TCBS only when you have API accounts.
