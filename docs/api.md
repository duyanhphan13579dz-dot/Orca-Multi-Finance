# Internal API — `/api/v1/*`

Envelope chuẩn cho mọi endpoint:

```json
// success
{ "success": true, "data": {}, "meta": { "source": "binance", "sourceTimestamp": "…", "ingestedAt": "…", "freshness": "LIVE", "ageMs": 830, "cached": false, "stale": false } }
// failure
{ "success": false, "error": { "code": "UPSTREAM_UNAVAILABLE", "message": "…" }, "meta": { "freshness": "UNAVAILABLE", … } }
```

| Endpoint | Mô tả | Nguồn |
| --- | --- | --- |
| `GET /api/v1/market/snapshot` | Snapshot tổng hợp: indices, crypto top+summary, forex, commodities, news, **pulse** + freshness per-section | engine |
| `GET /api/v1/stocks?symbols=VCB,HPG` | Board VN: indices + quotes | VNDirect · SSI/VPS/public fallback |
| `GET /api/v1/stocks/{symbol}` | Quote + OHLCV 250 + technical + patterns + financials | VNDirect · SSI/public fallback |
| `GET /api/v1/stocks/{symbol}/technical` | OHLCV + full indicator snapshot | VNDirect · Entrade/public fallback |
| `GET /api/v1/stocks/{symbol}/financials` | Income/balance/cashflow by period | VNDirect; optional VNStock financial fallback |
| `GET /api/v1/stocks/{symbol}/valuation` | Market multiples, multi-method fair value, DCF + sensitivity | quote + VNDirect statements/ratios |
| `GET /api/v1/stocks/{symbol}/valuation?peers=1` | Above plus same-sector peer comparison (higher latency) | multi-source |
| `GET /api/v1/stocks/{symbol}/valuation/analyst` | Deterministic valuation narrative; `?llm=1` optional | valuation engine (+LLM optional) |
| `GET /api/v1/stocks/{symbol}/style-fit` | Điều kiện pass/fail chi tiết của Minervini Trend Template và CANSLIM | OHLCV + market direction + BCTC best-effort |
| `GET /api/v1/crypto/markets?limit=&sort=gainers|losers|volume` | Toàn thị trường USDT spot + summary/breadth | Binance |
| `GET /api/v1/crypto/{symbol}?interval=15m|1h|4h|1d` | Ticker + klines + technical + patterns + funding/OI | Binance |
| `GET /api/v1/forex/markets` | 12 cặp major/minor/exotic + note sức mạnh USD | Biquote/fallback |
| `GET /api/v1/forex/{PAIR}` | Giá hiện tại + chuỗi ECB 12 tháng + technical | Biquote/ECB |
| `GET /api/v1/commodities` | Catalog + rows đa nguồn + unavailable list + impact mapping | multi |
| `GET /api/v1/news?category=&symbol=&limit=` | Tin tức đã dedupe/tag/validate timestamp | RSS multi-feed |
| `GET /api/v1/screener?universe=crypto&minChange=&maxChange=&minQuoteVolume=&limit=` | Screener rule-based | Binance |
| `GET /api/v1/reports/morning-brief` | Morning Brief analyst-style (freshness gate) | engine |
| `POST /api/v1/agent` `{question}` | AI Agent: intent → fetch data → answer + meta | engine (+LLM opt.) |
| `GET /api/v1/system/providers` | Provider health, circuit, latency, cache stats | ops |
| `POST /api/v1/auth/register` `{email,password,name?}` | Đăng ký (scrypt; JWT cookie) | auth |
| `POST /api/v1/auth/login` `{email,password}` | Đăng nhập | auth |
| `POST /api/v1/auth/logout` | Xóa phiên | auth |
| `GET /api/v1/auth/me` | Thông tin user hiện tại (401 nếu chưa login) | auth |

## Đơn vị và provenance định giá cổ phiếu

`/stocks/{symbol}/valuation` trả `currentPrice` và các fair value theo đơn vị quote thị trường. Với quote Việt Nam dưới 500, quote thường là nghìn VND; engine đổi sang VND đầy đủ trước khi tính vốn hóa/multiples rồi đổi fair value/cổ phiếu về đơn vị quote. `marketCap`/`enterpriseValue` dùng VND đầy đủ, `sharesOutstanding` là số cổ phiếu, dữ liệu per-share từ BCTC là VND/share. Các trường `valuationUnits` và `sourceDetails` cho biết quy đổi/nguồn đầu vào. Nếu thiếu CAPEX, nợ vay/tiền mặt bắt buộc, hoặc thiếu kỳ quý liên tiếp, giá trị phụ thuộc được để null/incomplete thay vì giả định bằng 0 hay dùng TTM một phần. So sánh peers chỉ chạy khi bật `?peers=1` để giới hạn độ trễ của request mặc định.
