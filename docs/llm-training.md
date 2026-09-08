# ORCA LLM — Huấn luyện đa ngữ cảnh 4 tầng (2-model Groq + OpenRouter free)

Hệ thống **tách 2 model kết hợp Groq + OpenRouter — full free không thẻ**, đã bỏ SiliconFlow theo yêu cầu.
- **Model 1 — AI Agent (Groq):** `openai/gpt-oss-120b` 131K (`GROQ_MODEL` / `AI_MODEL` / `AI_MODEL_REASONING`) — long-context 16t×3.5k, linh hoạt persona, 500 tok/s, 30 req/min free. *Groq đã deprecated `qwen/qwen3-32b` 07/2026 → `gpt-oss-120b` là replacement chính thức*. Alias cũ `qwen3.8-27b` tự chuyển. `src/lib/env.ts` default `openai/gpt-oss-120b`, `gateway.normalizeModel` xử lý.
- **Model 2 — Reports (OpenRouter):** `qwen/qwen3-235b-a22b:free` 131K (`OPENROUTER_MODEL` / `AI_MODEL_REPORT`, `gateway` role `report`) — deep analytical, tạo **Morning Brief / Market Summary / Market Strategy / Company Report** (`intelligence.ts` `generateStockReport` dùng `llmChat("report")` → OpenRouter 50 req/ngày/model). Fallback `deepseek/deepseek-r1:free` hoặc `openai/gpt-oss-120b:free`.

## Kiến trúc hiện tại

```
User question → detectIntent (regex + isFollowUpCue hotfix) → resolveIntent (sticky per-topic)
            → buildContract (market/crypto/forex/vn-stock/commodity/wealth/personal_finance)
            → conversation_memory (TopicSlot per persona) + RAG retrieve
            → llmChat(role=reasoning|analysis, systemFor(persona) + few-shot, history 8 turns)
            → validateOutput (anti-hallucination, tolerance 1%) → repair 1 lần → fallback deterministic
            → logConversation (DB) → response
```

## 4 tầng huấn luyện

### Tầng 1 — Prompt & Memory (runtime, đã triển khai)
- **Hotfix 19/09:** `isFollowUpCue` không còn `t.length<56` → sửa bug “Thị trường...” bị dính `wealth` (ảnh user).
- **Few-shot:** `SYS_STOCK` thêm ví dụ market/BTC để LLM trả 3-4 đoạn thay vì 1 dòng.
- **Memory:** `src/lib/services/agent-memory.ts` → `TopicSlot` per `personal_finance/wealth/crypto/market`, `sameTopicFamily` tách `money_life` vs `market_asset`.
- **Validation:** `src/lib/ai/validate.ts` — mọi số phải khớp `collectFactNumbers(contract)`.

Kiểm: `GET /api/v1/training/status` → Tầng 1 `done`

### Tầng 2 — Data Collection → SFT Dataset
- **Bảng:** `agent_conversations` + `agent_feedback` + `training_datasets` (`src/db/schema.ts`)
- **Collector:** `src/lib/ai/training/collector.ts` → `logConversation()` được gọi best-effort trong `POST /api/v1/agent`
- **Feedback:** `POST /api/v1/agent/feedback {conversationId, rating:-1|0|1, reason, correctedAnswer}` → DPO
- **Dataset:** `src/lib/ai/training/dataset.ts` → `toSftExample()` (`system/user/assistant` + `context`), `splitDataset 80/10/10`, `toJsonl()`, `datasetStats()` cân bằng persona
- **Chạy:**
  ```ts
  import { runTier2_DatasetBuild } from "@/lib/ai/training/pipeline";
  const { stats, trainCount } = await runTier2_DatasetBuild(1000);
  ```
- **Xuất JSONL:** `training/sft_qwen3-32b_20250919.jsonl` (mỗi dòng `{system,user,assistant}`)

### Tầng 3 — RAG đa ngữ cảnh
- **Store:** `src/lib/ai/training/rag.ts` → `InMemoryRag` (prototype, thay bằng PGVector khi bật `pgvector` extension)
- **Index:** `indexMarketSnapshot()` + `indexNews()` được gọi trong `pipeline.runTier3_RagIndex()` và có thể cron mỗi 15 phút
- **Retrieve:** `retrieveForQuestion(q, topK=3)` bổ sung vào `meta.note` và `STRUCTURED CONTEXT` trước khi gọi LLM
- **Chunk:** 600 chars, recency boost 72h

### Tầng 4 — Eval + DPO + LoRA Fine-tune
- **Eval harness:** `src/lib/ai/training/eval.ts` → `DEFAULT_EVAL_SET` 7 case (market, crypto, wealth, personal_finance, vn-stock, compare, multi-context), `runEval()` đo `intentAccuracy`, `hallucinationRate`, `avgLatency`
  ```ts
  const { runTier4_Eval } = await import("@/lib/ai/training/pipeline");
  const r = await runTier4_Eval(); // intentAccuracy 0.85 = đạt
  ```
- **DPO:** `agent_feedback.correctedAnswer` → `toDpoExample()` → `dpo_qwen3-32b.jsonl` (`prompt/chosen/rejected`)
- **LoRA SFT:** `scripts/train-llm/sft.py` (template) — `gpt-oss-120b` cho Agent (Groq), `qwen3-235b` cho Reports (OpenRouter), rank 16, alpha 32, lr 2e-4, epoch 3, batch 4, max_seq 4096 (tận dụng 131K)
  ```bash
  python scripts/train-llm/sft.py --base openai/gpt-oss-120b --data training/sft_agent.jsonl --output adapters/gpt-oss-120b-orca --lora-r 16
  python scripts/train-llm/dpo.py --base adapters/gpt-oss-120b-orca --data training/dpo.jsonl
  # Reports (company/morning): fine-tune riêng trên qwen/qwen3-235b-a22b:free với dataset reports
  ```
- **Deploy:** merge LoRA → `gpt-oss-120b-orca` (Agent/Groq) / `qwen3-235b-orca-reports` (OpenRouter) hoặc self-host `vllm` → Groq `GROQ_MODEL=openai/gpt-oss-120b`, OpenRouter `OPENROUTER_MODEL=qwen/qwen3-235b-a22b:free`

## Vận hành

- **Thu thập:** mỗi `POST /api/v1/agent` tự log; UI Agent thêm nút 👍/👎 gọi `POST /api/v1/agent/feedback`
- **Giám sát:** `GET /api/v1/training/status` → 7 tiers status + `llm.configured/model`
- **Lịch:** cron `0 2 * * *` → `runTier3_RagIndex()` + `runTier2_DatasetBuild()` → nếu `trainCount>500` trigger SFT nightly

## Bảo vệ & Vercel (Groq + OpenRouter free)

- Mọi tầng đều **giữ nguyên** `validateOutput` — LLM không được bịa số ngoài `contract`
- **2-model Groq + OpenRouter** full free không thẻ: Agent `openai/gpt-oss-120b` 131K Groq 30/min, Reports `qwen/qwen3-235b-a22b:free` 131K OpenRouter 50/ngày, alias cũ tự chuyển.
- **Vercel:** Project → Settings → Environment Variables → thêm `GROQ_API_KEY=gsk_...` (https://console.groq.com/keys), `OPENROUTER_API_KEY=sk-or-...` (https://openrouter.ai/keys), `GROQ_MODEL=openai/gpt-oss-120b`, `OPENROUTER_MODEL=qwen/qwen3-235b-a22b:free` (scope Production/Preview/Development) → Redeploy. Legacy `AI_PROVIDER_KEY` vẫn fallback về Groq nếu chỉ set 1 key. Fallback Reports: `deepseek/deepseek-r1:free`.
