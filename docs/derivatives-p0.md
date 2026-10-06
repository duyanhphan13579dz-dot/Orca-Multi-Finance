# Vietnam Derivatives — P0 Contract Master

Ngày: 2026-10-06  
Phạm vi: Contract Master + adapters + API (chưa Flow Engine / curve history).

## Đã giao

| Layer | Path |
|-------|------|
| Schema | `src/db/schema.ts` → `derivative_products`, `derivative_contracts`, `derivative_prices`, `derivative_open_interest` |
| SQL manual | `drizzle/manual/002_derivatives_contract_master.sql` |
| Types | `src/lib/types.ts` (`DerivativeProduct`, `DerivativeContract`, `DerivativeQuote`, `DerivativeBasis`, …) |
| VSDC seed | `src/lib/providers/vsdc-spec.ts` |
| HNX / SSI DER adapter | `src/lib/providers/hnx-derivatives.ts` |
| Service | `src/lib/services/derivatives.ts` |
| API | `GET /api/v1/derivatives/contracts` |
| | `GET /api/v1/derivatives/snapshot` |
| | `GET /api/v1/derivatives/{symbol}` |
| UI | `/derivatives` đọc snapshot API (N/A khi thiếu quote) |

## Nguyên tắc dữ liệu

- **Không** bịa giá / OI / basis.
- Thiếu quote → `null` + `meta.partial` + note rõ nguồn.
- Contract Master luôn có từ seed VSDC (multiplier 100.000 VND/điểm, tick 0.1, cash settlement).
- Basis = `futures.last − VN30.spot` chỉ khi cả hai có số hợp lệ.

## Cấu hình live quote

1. **SSI FastConnect Data** (ưu tiên):  
   `SSI_API_KEY` + `SSI_API_SECRET` hoặc `SSI_FC_CONSUMER_ID` + `SSI_FC_CONSUMER_SECRET`  
   Adapter gọi market endpoints với symbol phái sinh / `Market=DER`.

2. **Generic URL** (tuỳ chọn):  
   `DERIVATIVES_QUOTE_URL=https://example.com/quote?symbol={symbol}`  
   `DERIVATIVES_QUOTE_API_KEY=` (Bearer, optional)

## API examples

```http
GET /api/v1/derivatives/contracts
GET /api/v1/derivatives/snapshot?core=1
GET /api/v1/derivatives/snapshot?symbols=VN30F1M,VN30F2M
GET /api/v1/derivatives/VN30F1M
```

## Tiếp theo (P1 / P1.5)

- Persist quotes → `derivative_prices` / OI history  
- Intraday OHLCV cho VN30F  
- Flow Engine: Long/Short build-up từ Δprice × ΔOI  
- Gỡ block `UNAVAILABLE` trong intraday/market-summary composers khi meta FRESH  
- Margin versioned từ VSDC


## P1 — OHLCV

- `GET /api/v1/derivatives/{symbol}/ohlcv?days=60`
- Provider: SSI DailyOhlc hoặc `DERIVATIVES_OHLCV_URL`

## P1.5 — Flow Engine

- `src/lib/engines/derivatives-flow.ts`
- Snapshot trả `flow[]`: long_build_up | short_build_up | short_covering | long_liquidation
- ΔOI: so sánh quote hiện tại với snapshot process trước (poll 30s) hoặc OI history khi có
