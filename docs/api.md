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
| `GET /api/v1/stocks?symbols=VCB,HPG` | Board VN: indices + quotes | SSI FC v3 → SSI v2 → VNDirect |
| `GET /api/v1/stocks/{symbol}` | Quote + OHLCV 250 + technical + patterns + financials | SSI FC v3 → VNDirect |
| `GET /api/v1/stocks/{symbol}/technical` | OHLCV + full indicator snapshot | SSI FC v3 → VNDirect |
| `GET /api/v1/stocks/{symbol}/financials` | income/balance/ratios theo quý | VNDirect/SSC |
| `GET /api/v1/chart/history?assetType=stock&timeframe=1m…1h` | Nến intraday VN (1m/3m/5m/15m/30m/1h) — cần SSI FC v3 | SSI FC v3 `data/ohlc` |
| `GET /api/v1/ssi/status` | Trạng thái kết nối SSI (auth probe, WS stats, trading readiness) | ssi-fastconnect |
| `GET /api/v1/ssi/account?accountNo=` | Tiểu khoản + số dư + vị thế + PP/MMR (login; không cần OTP) | SSI FC v3 |
| `GET /api/v1/ssi/orders?accountNo=` | Sổ lệnh trong ngày / theo khoảng from-to ISO (login) | SSI FC v3 |
| `POST /api/v1/ssi/orders` | Đặt lệnh `{accountNo,symbol,side,orderType,quantity,price?,otp\|transactionId}` (login + SSI_TRADING_ENABLED) | SSI FC v3 signed |
| `PUT /api/v1/ssi/orders` | Sửa lệnh (price HOẶC quantity) | SSI FC v3 signed |
| `DELETE /api/v1/ssi/orders` | Hủy lệnh | SSI FC v3 signed |
| `POST /api/v1/ssi/otp` | Yêu cầu OTP / SmartOTP transactionId (login) | SSI FC v3 |
| `GET /api/v1/ssi/fco?view=list\|orderbook\|statusHistory` | Truy vấn lệnh điều kiện (login) | SSI FC v3 |
| `POST /api/v1/ssi/fco` / `DELETE` | Đặt / hủy FCO (login + SSI_TRADING_ENABLED + OTP) | SSI FC v3 signed |
| `GET /api/v1/system/ssi-ws` | Trạng thái engine stream SSI (v3 + legacy) | ops |
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
