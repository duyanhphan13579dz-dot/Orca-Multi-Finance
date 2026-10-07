# ORCA Data Engine Hub

Train LLM tạm dừng. Agent giữ form hiện tại. Data-engine: kết nối nguồn + chia sẻ giữa module.

## Đã triển khai (4 bước)

1. **`answerQuestion`** bọc `runInDataHub` (`src/lib/services/agent.ts`)
2. **`agent-vn-stock`** + **`snapshots`** dùng hub singleflight (quote, BCTC, news, package)
3. **Hub loaders**: `hubVnQuotes`, `hubCryptoDetail`, `hubForexDetail`, `hubCommodityMarket`, `hubNews`, `hubFinancialPackage`
4. **Health API**: `GET /api/v1/ops/data-engine`

## Kiến trúc

```text
answerQuestion → runInDataHub
  hubFinancialPackage / hubVnQuotes / hubNews …
  valuation / screener / agent-vn-stock reuse same keys
```

## API

```bash
curl -s https://YOUR_HOST/api/v1/ops/data-engine | jq .data.catalog.byDomain
```
