# ORCA Data Engine Hub

Train LLM tạm dừng. Agent giữ form hiện tại. Tập trung **data-engine**: kết nối nguồn + chia sẻ giữa module.

## Mục tiêu

1. **Một lần gọi nguồn / một key / một request**
2. **Catalog nguồn** primary / fallback theo domain
3. **Cross-check** số đã có trong hub — không gọi API thêm

## Kiến trúc

```text
answerQuestion
    runInDataHub(...)
        hubFinancialPackage("FPT")  // fetch once
        valuation / CANSLIM         // reuse hub
        hubCrossCheckNumbers(...)   // offline
```

| File | Vai trò |
|------|--------|
| `request-scope.ts` | AsyncLocalStorage theo request |
| `coalesce.ts` | Singleflight |
| `catalog.ts` | Danh mục nguồn |
| `hub.ts` | API shared |

## Dùng trong code

```ts
import { runInDataHub, hubFinancialPackage } from "@/lib/data-engine";

export async function answerQuestion(q, prefs) {
  return runInDataHub(async () => {
    /* existing agent body */
  });
}

const pkg = await hubFinancialPackage("FPT");
```

Hub bổ sung `cache.ts` (TTL cross-request): hub = **trong một turn** không gọi lại.

## Việc tiếp theo

1. Bọc `answerQuestion` bằng `runInDataHub`
2. Đổi agent-context / valuation / snapshots → `hubFinancialPackage`
3. `hubLoad` cho quote, crypto, forex, commodity, news
4. Health API: `catalogSummary()` + `hubStats()`
