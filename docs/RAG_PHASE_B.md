# ORCA — Phase B: SFT / DPO trên format RAG

## Mục tiêu

Fine-tune model analysis để:
1. Nội hóa **giọng senior research analyst**
2. Học format **CONTEXT + TÀI LIỆU TRUY XUẤT → câu trả lời**
3. Tránh meta-talk, advice cứng, bịa số

**Không** dạy model “nhớ giá/BCTC” — quant + RAG runtime vẫn là nguồn sự thật.

## Base model khuyến nghị

| GPU | Base HF | Ghi chú |
|-----|---------|---------|
| T4 16GB | `Qwen/Qwen2.5-7B-Instruct` hoặc `14B` QLoRA | Colab ổn |
| A100 40GB | `Qwen/Qwen2.5-14B-Instruct` / `32B` QLoRA | Tốt hơn |

## Dataset

- `samples/sft_rag_train.jsonl` — SFT có field `retrieved`
- `samples/dpo_rag_pairs.jsonl` — preferred vs rejected
- `scripts/format_chat_example.py` — JSONL → chat messages
- `scripts/train_qlora_README.md` — Colab + vLLM + env

## Deploy

```bash
AI_BASE_URL=https://YOUR_GPU_HOST/v1
AI_MODEL_ANALYSIS=orca-analyst-v1
AI_MODEL_ANALYSIS_FALLBACKS=qwen/qwen3.8-27b:free,inclusionai/ling-3.0-flash-fin:free
OPENROUTER_API_KEY=...
```

Gateway đã hỗ trợ `AI_BASE_URL`.

## Phase C

Embedding / pgvector — cải retrieve, không thay SFT.
