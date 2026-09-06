# ORCA AI Agent — Kiến trúc & Tài liệu kỹ thuật

> Nâng cấp toàn bộ hệ thống AI Agent của ORCA Financial theo kiến trúc:
> **ORCA AI CORE → AI ORCHESTRATOR → 3 AGENT CHUYÊN BIỆT → ORCA FINANCIAL TOOL LAYER → ORCA DATA ENGINE**
> Không phải chatbot đơn với một system prompt khổng lồ.
> UI/UX **giữ nguyên**; API `/api/v1/agent` **không phá** (compatibility layer).

---

## 1. Kiến trúc tổng quan

```
                    ┌──────────────────────────────────────────────┐
                    │  /api/v1/agent  (POST) — compatibility entry │
                    └──────────────────────┬───────────────────────┘
                                           │
                    ┌──────────────────────▼───────────────────────┐
                    │   ORCA AI CORE / AI ORCHESTRATOR             │
                    │   - classifyFinancial (deterministic)        │
                    │   - chọn 1 hoặc NHIỀU agent (multi-agent)    │
                    │   - intent legacy → answerQuestion (gốc)     │
                    └───────┬──────────────┬──────────────┬────────┘
                            │              │              │
               ┌────────────▼───┐  ┌───────▼───────┐  ┌───▼────────────┐
               │ STOCK ANALYST  │  │ PERSONAL      │  │ WEALTH         │
               │                │  │ FINANCE       │  │ MANAGER        │
               └────────────┬───┘  └───────┬───────┘  └───┬────────────┘
                            │              │              │
                    ┌───────▼──────────────▼──────────────▼────────┐
                    │   ORCA FINANCIAL TOOL LAYER (executeTool)    │
                    │   ≥ 36 tools · structured data · no-bs       │
                    └───────┬──────────────────────────┬───────────┘
                            │                          │
              ┌─────────────▼────────────┐  ┌──────────▼──────────────┐
              │ ORCA DATA ENGINE (cũ)    │  │ Financial Profile +     │
              │ VNDirect/Binance/        │  │ Financial Memory (DB,   │
              │ Swissquote/VCB/ECB/...   │  │ consent-gated, per-user)│
              └──────────────────────────┘  └─────────────────────────┘
```

**Nguyên tắc xuyên suốt**
1. **Data-first**: mọi con số phải trace về Tool Layer → Data Engine. LLM chỉ viết văn bản từ structured data.
2. **Không bịa**: thiếu dữ liệu → `DATA_UNAVAILABLE` kèm lý do; không sinh giá/chỉ số/tin/recommendation/holdings.
3. **Không kết luận từ 1 chỉ số**: stock analyst yêu cầu ≥ 2 nhóm bằng chứng mới có mức độ thuyết phục.
4. **Không gọi hết agent**: orchestrator chọn agent theo intent; chỉ multi-agent khi câu hỏi có phạm vi nhiều khối.
5. **UI/API đóng băng**: không đổi UI; intent cũ đi đúng pipeline cũ.

---

## 2. Thành phần

### 2.1 Financial Math Engine — `src/lib/finance/financial-math.ts`
Thuần, deterministic, test được (26 tests). Mọi hàm trả `null` khi thiếu input — không đoán, không trả 0 giả.

| Nhóm | Hàm |
|---|---|
| Cash flow | `computeCashFlow` |
| Net worth | `computeNetWorth` |
| Tỷ lệ | `computeSavingsRate`, `computeDebtToIncome`, `computeEmergencyFundCoverage`, `computeLiquidityRatio`, `computeLeverageRatio` |
| Health | `computeFinancialHealth` (5 metrics weighted 0–100, `STRONG/OK/WEAK/CRITICAL/UNAVAILABLE`) |
| Goal | `projectGoal` (FV annuity), `requiredMonthlySaving`, `computeGoalProgress` |
| Portfolio | `computeAssetAllocation`, `computeConcentration` (HHI + top1), `computeSectorExposure`, `computeCurrencyExposure`, `computePortfolioReturn`, `computePortfolioRiskProxy` (cận trên, tương quan=1 — model inference), `computeMaxDrawdown` |
| Scenario | `runPortfolioScenario` (shock theo asset class) |

### 2.2 Financial Profile — `src/lib/finance/financial-profile.ts`
- `RawProfileInput` chấp nhận chuỗi VN (`"30,000,000 đ"`, `"abc"` → lỗi field, không đoán).
- Validation deterministic: field sai bị **loại khỏi inputs** + ghi `errors`; `valid`, `completeness`.
- `derive()`: mọi chỉ số là `Value<T> { value, available }` — thiếu dữ liệu → `available:false`, không phạt 0.
- Chứa: thu nhập/chi tiêu/trả nợ/thanh khoản/tài sản/nợ, risk profile, birthYear, goals[], holdings[].

### 2.3 Tool Layer — `src/lib/agents/tool-types.ts`, `tools.ts`, `market-tools.ts`, `finance-tools.ts`
- `executeTool(name, args, ctx)`: validate params (required/enum/number min-max/array), `CONSENT_REQUIRED` khi cần profile, try/catch provider → `DATA_UNAVAILABLE`.
- `listTools()` / `toolNamesIn(domains)`.
- **36 tools**, 7 domain, mọi output structured (object), meta kèm `source/freshness/provider/trace`.

| Domain | Tools |
|---|---|
| stock | `get_stock_quote`, `get_stock_profile`, `get_stock_financials`, `get_stock_valuation`, `get_stock_technicals`, `get_stock_history`, `get_stock_news`, `get_stock_reports`, `get_stock_recommendations` |
| market | `market_context`, `sector_context`, `market_breadth`, `get_vn_indices` |
| commodity | `commodity_quotes` |
| macro | `macro_fx_snapshot`, `get_metal_quote` |
| portfolio | `get_portfolio`, `portfolio_return`, `portfolio_risk`, `max_drawdown`, `concentration`, `sector_exposure`, `asset_allocation`, `currency_exposure`, `rebalancing_plan` |
| personal-finance | `cash_flow`, `net_worth`, `savings_rate`, `debt_to_income`, `emergency_fund`, `financial_health`, `goal_progress`, `required_monthly_saving` |
| scenario | `financial_scenario`, `portfolio_scenario`, `goal_projection` |

### 2.4 Bốn Agent

#### Stock Analyst — `src/lib/agents/stock-analyst.ts`
Thesis → Sức mạnh tài chính → Định giá → Kỹ thuật → Xúc tác → Rủi ro → Invalidation → Kết luận.
- `buildConviction`: mức độ thuyết phục = **số nhóm bằng chứng** (≥5 HIGH, ≥3 MEDIUM, ≥2 LOW); không kết luận từ 1 chỉ số.
- Mọi section luôn tồn tại; thiếu dữ liệu → `unavailable:true` + body trung thực.
- LLM optional: viết lại theo contract → `validateOutput` → regenerate 1 lần → fallback deterministic.

#### Personal Finance — `src/lib/agents/personal-finance.ts`
FinancialProfile + Health Engine (savings rate, DTI, quỹ khẩn cấp, thanh khoản, đòn bẩy) + **action plan ưu tiên HIGH/MEDIUM/LOW** theo rule minh bạch (`healthPlan`).
- Không profile → `DATA_UNAVAILABLE` + hướng dẫn tạo profile (có consent).

**Budget Planner** (`runBudgetPlanner`, parser `src/lib/finance/budget-parser.ts` + tool `budget_plan`):
- Câu hỏi ngân sách ad-hoc (VD: "Tôi còn 500k tiêu trong 2 tuần, 1 tuần xăng hết 50k, ăn quán hết 50k") → trích số tiền/chu kỳ/khoản cố định bằng deterministic parser → plan: ngân sách tuần, chi phí cố định, phần còn lại, gợi ý 50/20/30 (MODEL-INFERENCE kèm disclaimer).
- **Không cần profile, KHÔNG lưu vào memory** (không consent trong luồng ad-hoc) — dữ liệu chỉ dùng 1 lần.
- Intent `budget-plan` được ưu tiên trước pipeline thị trường legacy (fix regression: câu "500k tiêu 2 tuần" trước đây bị trả snapshot thị trường).

#### Wealth Manager — `src/lib/agents/wealth-manager.ts`
Danh mục → Phân bổ tài sản → Tập trung (HHI) → Phơi nhiễm ngành/tiền tệ → Thanh khoản → Drawdown → Rủi ro danh mục → **Kế hoạch tái cân bằng** (MODEL-INFERENCE kèm disclaimer).
- Target allocation theo risk profile + tuổi (quy tắc 100−tuổi, clamp 20–70) — model inference có disclosure.

#### Orchestrator — `src/lib/agents/orchestrator.ts`
- `classifyFinancial`: deterministic keyword + symbol detection.
  - `stock-analysis` → Stock Analyst
  - `wealth` → Wealth Manager
  - `personal-finance` → Personal Finance
  - `stock-budget` ("500 triệu mua HPG") → **3 agents** (stock + wealth + personal finance)
- Intent legacy → `answerQuestion` **nguyên vẹn** (crypto/forex/commodity/vn-stock/market/news/general) — zero regression.
- Meta: `pipeline` trace, `dataConfidence`, `providers`, `qualityStatus` (VALID/SUSPECT), `freshness` worst-of.

### 2.5 Financial Knowledge Base — `src/lib/agents/knowledge.ts`
Tĩnh (methodology/định nghĩa/ngưỡng/quy tắc phân loại bằng chứng), **không bao giờ chứa realtime data** (giá, tỷ lệ, tin). `searchKnowledge(category?, query?)` theo title/body/sources.

### 2.6 Financial Memory — `src/lib/agents/financial-memory.ts` + DB
- Bảng mới: `financial_profiles` (userId PK, profile jsonb, **consent** bool, consentAt), `financial_memory_logs`.
- Tách khỏi conversation memory; **chỉ lưu khi consent=true**; cập nhật/xóa được; access control theo `userId` (session); không trộn dữ liệu giữa user.
- `getFinancialProfile`, `saveFinancialProfile`, `deleteFinancialProfile`, `setFinancialConsent`.

### 2.7 API
| Endpoint | Mô tả |
|---|---|
| `POST /api/v1/agent` | hành vi cũ giữ nguyên (financial mới / legacy delegate) + `GET` liệt kê tools (additive) |
| `PUT/GET/DELETE /api/v1/agent/profile` | Financial Memory có consent + auth |
| `npm run eval:ai` | benchmark nội bộ 4 khối |

### 2.8 LLM Gateway & Synthesis — `src/lib/ai/gateway.ts`, `src/lib/agents/llm-synth.ts`
**Có thể gọi LLM để trả lời.** Gateway OpenAI-compatible, **optional** (deterministic là nguồn chính thức khi chưa cấu hình):

| Env | Ý nghĩa |
|---|---|
| `AI_PROVIDER_KEY` | **Bật LLM** (bỏ trống → toàn bộ chạy deterministic) |
| `AI_BASE_URL` | OpenAI-compatible endpoint (mặc định `https://api.openai.com/v1`) |
| `AI_MODEL` | Model mặc định (`gpt-4o-mini`) |
| `AI_MODEL_REASONING` / `AI_MODEL_ANALYSIS` / `AI_MODEL_CLASSIFICATION` | Model theo role |

Đường đi LLM hiện tại:
- **Pipeline legacy** (`answerQuestion`): `llmChat(role)` → `validateMaybeRepair` (regenerate 1 lần → fallback deterministic).
- **Stock Analyst**: `runStockAnalystWithLLM` — LLM viết tổng hợp từ sections, validate chặt.
- **Personal Finance / Wealth / Budget** (mới): `synthesizeRun(run, {question})` — cùng guard: `collectFactNumbers(sections[].data)` → `validateOutput(text, facts)`; số lạ → regenerate 1 lần → vẫn sai → **giữ nguyên narrative deterministic**; trace `llm:<model>[:regenerated]` / `llm:fallback-deterministic` / `llm:not-configured`.
- Kiểm tra trạng thái: `/api/v1/system/info` (hoặc `llmRegistryInfo`).

### 2.9 Anti-hallucination (`src/lib/ai/validate.ts` — tái sử dụng từ hệ thống cũ)
`collectFactNumbers(contract)` → `validateOutput(text, facts)`: số trong answer phải trace về contract; sai → regenerate 1 lần → fallback deterministic. Parser hỗ trợ vi-VN `1.234,56`, `26,255`, `500.000` (chấm hàng nghìn) và en-US `1,234.56`. Agent sections phân loại `FACT / DATA-DRIVEN / MODEL-INFERENCE / SCENARIO / OPINION`.

---

## 3. Phân loại bằng chứng (response standard)

| Nhãn | Ví dụ | Nguồn |
|---|---|---|
| FACT | giá, khối lượng, tin, hồ sơ doanh nghiệp | Tool Layer / data engine |
| DATA-DRIVEN | điểm sức khỏe tài chính, trọng số, HHI, P/E | math engine từ FACT |
| MODEL-INFERENCE | target allocation 100−tuổi, volatility cận trên, DCF | mô hình/giả định — luôn có disclaimer |
| SCENARIO | shock -10% cổ phiếu, mất việc 6 tháng | scenario tools |
| OPINION | kết luận khi < 2 nhóm bằng chứng | agent synthesis |

Văn phong: analyst VN tự nhiên, thesis → bằng chứng → phân tích → rủi ro → kịch bản → kết luận actionable; **cấm** "THỊ TRƯỜNG TRUNG TÍNH / BALANCED MARKET / CHƯA ĐỦ DỮ LIỆU" rời rạc không kèm context.

---

## 4. Test & Verification

| Hạng mục | Kết quả |
|---|---|
| `npm test` | **327/327 pass** (252 cũ + mới: finance-math 26, profile 5, finance-tools 8, agents 8, ai-eval 12, budget 11, llm-synth 5) |
| `npm run typecheck` | PASS |
| `npm run lint` | 0 errors (18 warnings pre-existing) |
| `npm run build` | PASS (22 pages) |
| `npm run eval:ai` | benchmark 4 khối (tool layer / anti-hallucination / agents / orchestrator / KB) |

Regression quan trọng: `agent-pipeline.test.ts`, `question-router.test.ts`, `event-intelligence.test.ts`, toàn bộ forex/metals tests vẫn xanh — intent legacy không đổi hành vi.

---

## 5. Giới hạn & minh bạch

- **Không fine-tuning** (Phase 10): đúng spec — chưa cần, vì DATA → TOOLS → WORKFLOWS → KB → EVALUATION mới tới prompt optimization.
- **Drawdown danh mục**: chưa có chuỗi giá vị thế trong profile → trả UNAVAILABLE trung thực (có `max_drawdown` tool để tính khi có chuỗi).
- **Recommendations analyst**: VNDirect không công bố qua REST public → tool luôn trả `DATA_UNAVAILABLE` + reason, không bịa.
- **Profile cần người dùng cung cấp**: không tự đoán thu nhập/tài sản từ câu hỏi chat.
