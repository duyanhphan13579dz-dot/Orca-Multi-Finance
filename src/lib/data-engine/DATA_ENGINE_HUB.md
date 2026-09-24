# ORCA Data Engine Hub

Train LLM tạm dừng. Agent giữ form hiện tại (deterministic + OpenRouter). Tập trung **data-engine**: kết nối nguồn + chia sẻ dữ liệu giữa module.

## Mục tiêu

1. **Một lần gọi nguồn / một key / một request** — stock, valuation, CANSLIM, agent không fetch BCTC 3 lần.
2. **Catalog nguồn** — liệt kê primary / fallback theo domain.
3. **Cross-check** — module đối chiếu số đã có trong hub, không gọi API thêm.

## Kiến trúc

```text
answerQuestion / API handler
        │
        ▼
  runInDataHub(async () => { ... })
        │
        ├── hubFinancialPackage("FPT")  → fetch VNDIRECT once
        ├── valuation module            → hubFinancialPackagePeek / same key
        ├── fundamental / CANSLIM       → cùng package
        └── hubCrossCheckNumbers(...)   → so sánh offline
```

| File | Vai trò |
|------|---------|
| `request-scope.ts` | AsyncLocalStorage bag theo request |
| `coalesce.ts` | Singleflight (hub + process) |
| `catalog.ts` | Danh mục nguồn (market, FS, crypto…) |
| `hub.ts` | API: `hubFinancialPackage`, `hubVnQuotes`, `hubLoad`, cross-check |
| `index.ts` | Public exports |

## Cách dùng trong module

```ts
import { hubFinancialPackage, hubFinancialPackagePeek, runInDataHub } from "@/lib/data-engine";

// Entry (agent):
export async function answerQuestion(q: string, prefs) {
  return runInDataHub(async () => {
    // ... existing logic
  });
}

// Thay vì getFinancialPackage(symbol) trực tiếp:
const pkg = await hubFinancialPackage(symbol);

// Module khác trong cùng request:
const same = hubFinancialPackagePeek(symbol); // undefined nếu chưa ai load
```

## Accessors sẵn có

| Accessor | Key | Source |
|----------|-----|--------|
| `hubFinancialPackage(sym)` | `financial:package:SYM` | vndirect-fs |
| `hubVnQuotes(symbols[])` | `market:quote:A,B,...` | vndirect / stocks service |
| `hubCryptoDetail(sym)` | `crypto:quote:SYMUSDT` | binance |
| `hubForexDetail(pair)` | `forex:pair:PAIR` | forex-feed |
| `hubCommodityMarket(id?)` | `commodity:all` | vietnambiz goods |
| `hubNews({ symbol?, limit? })` | `news:...` | news-bundle |
| `hubMacro(id)` | `macro:id` | economic-data |
| `hubLoad(key, producer)` | arbitrary | custom |

## Liên kết sẵn có (giữ nguyên)

- `src/lib/cache.ts` — TTL + SWR + Redis (cross-request)
- `src/lib/financial/provider.ts` — router priority FS
- `src/lib/financial/validation.ts` — cross-validate periods
- Hub — **trong một request**, module-to-module

Hub **không thay** cache TTL; nó bổ sung lớp “cùng turn không gọi lại”.

## Đã triển khai (4 bước)

1. ✅ Bọc `answerQuestion` bằng `runInDataHub`.
2. ✅ `getFinancialPackage` coalesce; valuation-peers → `hubVnQuotes`; snapshots kế thừa.
3. ✅ `hubLoad` + typed getters: quote VN, crypto, forex, commodity, news, macro.
4. ✅ `GET /api/v1/system/data-engine` → `catalogSummary()` + `hubStats()` + source health.

## Đã wire module

- ✅ `agent-context` / `buildVnStockFull` → hubFinancialPackage / hubVnQuotes / hubCryptoDetail / hubForexDetail / hubCommodityMarket
- ✅ `agent-vn-stock` → hubVnQuotes / hubFinancialPackage / hubNews
- ✅ fundamental / valuation / CANSLIM screeners → hubVnQuotes (+ snapshots hubFinancialPackage)
- ✅ `financial/service` → coalesce wrapper

## Việc tiếp theo (tuỳ chọn)

- Screener / CANSLIM gọi `hubFinancialPackagePeek` trước khi fetch khi cần.
- Thêm Redis touch log aggregation nếu cần observability multi-instance.
