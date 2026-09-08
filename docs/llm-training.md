# ORCA LLM — Huấn luyện đa ngữ cảnh 4 tầng (qwen3-32b 128K long-context)

`model` toàn hệ thống đã **cố định `Qwen/Qwen3-32B` 128K** (`src/lib/env.ts` + `src/lib/ai/gateway.ts` normalize, alias cũ `qwen3.8-27b` tự chuyển). Mọi `AI_MODEL*` override đều được chuẩn hoá. **Nguồn mới: SiliconFlow** (`https://api.siliconflow.cn/v1`, miễn phí công khai, ưu tiên Qwen) thay Groq do Groq không ưu tiên 32B. Fallback OpenRouter vẫn hỗ trợ.

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
- **LoRA SFT:** `scripts/train-llm/sft.py` (template) — Qwen3 32B, rank 16, alpha 32, lr 2e-4, epoch 3, batch 4, max_seq 4096 (tận dụng 128K)
  ```bash
  python scripts/train-llm/sft.py --base qwen/qwen3-32b --data training/sft_qwen3-32b.jsonl --output adapters/qwen3-32b-orca --lora-r 16
  python scripts/train-llm/dpo.py --base adapters/qwen3-32b-orca --data training/dpo.jsonl
  ```
- **Deploy:** merge LoRA → `qwen3-32b-orca` → push **SiliconFlow** private hoặc self-host `vllm` → trỏ `AI_BASE_URL` về endpoint mới (không cần đổi `AI_MODEL` vì đã chuẩn hoá)

## Vận hành

- **Thu thập:** mỗi `POST /api/v1/agent` tự log; UI Agent thêm nút 👍/👎 gọi `POST /api/v1/agent/feedback`
- **Giám sát:** `GET /api/v1/training/status` → 7 tiers status + `llm.configured/model`
- **Lịch:** cron `0 2 * * *` → `runTier3_RagIndex()` + `runTier2_DatasetBuild()` → nếu `trainCount>500` trigger SFT nightly

## Bảo vệ

- Mọi tầng đều **giữ nguyên** `validateOutput` — LLM không được bịa số ngoài `contract`
- Model **cố định** `Qwen/Qwen3-32B` 128K — alias cũ tự chuyển, **nguồn SiliconFlow** (Groq đã bỏ), long-context 16 turns × 3.5k
