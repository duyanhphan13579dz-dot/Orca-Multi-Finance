# ORCA LLM — Dataset SFT / DPO (Human-like Research Voice)

Mục tiêu: fine-tune (hoặc preference-tune) model analysis của ORCA để trả lời **dài hơn, chi tiết hơn, giống senior equity research analyst Việt Nam**, vẫn tuân thủ hard rules:

- Chỉ dùng số liệu từ CONTEXT / NARRATIVE quant
- Không bịa số, không bịa nguồn
- Không khuyến nghị mua/bán tuyệt đối
- Phân biệt rõ dữ liệu vs diễn giải

## Cấu trúc thư mục

```text
datasets/llm-human-voice/
  README.md                 # file này
  SCHEMA.md                 # schema chi tiết
  PIPELINE.md               # quy trình thu thập → train → deploy
  samples/
    sft_train.jsonl         # supervised fine-tune (instruction → preferred)
    dpo_pairs.jsonl         # preferred vs rejected
    seed_templates.json     # template sinh dữ liệu
```

## Hai dạng dữ liệu

### 1. SFT (Supervised Fine-Tuning)

Mỗi dòng JSONL:

```json
{
  "id": "sft-market-001",
  "branch": "market|stock|industry|commodity|compare|general",
  "depth": "concise|standard|deep",
  "language": "vi",
  "question": "...",
  "context_narrative": "...",
  "context_contract": { },
  "preferred_answer": "..."
}
```

Dùng để dạy model: với (question + context quant) → viết theo giọng người + cấu trúc depth.

### 2. DPO / ORPO (Preference)

Mỗi dòng JSONL:

```json
{
  "id": "dpo-stock-001",
  "branch": "stock",
  "depth": "deep",
  "language": "vi",
  "question": "...",
  "context_narrative": "...",
  "context_contract": { },
  "preferred": "...",
  "rejected": "..."
}
```

- **preferred**: giọng analyst tự nhiên, số liệu gắn ý nghĩa, chuyển tiếp mượt
- **rejected**: liệt kê khô, cụm máy móc, thiếu liên kết, hoặc (cố ý) hơi bịa / quá ngắn

## Quy mô khuyến nghị

| Giai đoạn | SFT | DPO pairs | Ghi chú |
|-----------|-----|-----------|---------|
| Seed (MVP) | 80–150 | 40–80 | 4 nhánh × depth |
| Phase 1 | 400–800 | 200–400 | + compare, news, rates |
| Phase 2 | 1500+ | 800+ | production quality |

Ưu tiên chất lượng > số lượng. Mỗi preferred phải **pass validateOutput** (mọi số trace được về context).

## Hard filters (bắt buộc trước khi đưa vào train)

1. `validateOutput(preferred, collectFactNumbers(contract))` → `ok === true`
2. Không chứa: "nên mua", "nên bán ngay", "khuyến nghị mua", target giá tuyệt đối không có trong context
3. Preferred length theo depth:
   - concise: 120–400 từ
   - standard: 350–700 từ
   - deep: 550–1100 từ
4. Rejected phải khác rõ preferred (không chỉ sửa 1–2 từ)

## Model target

- Base: model đang dùng cho role `analysis` trên OpenRouter (Qwen / Ling-Flash-Fin / Llama-class)
- Train: QLoRA 4-bit hoặc full SFT nếu GPU đủ
- Deploy: trỏ `AI_MODEL_ANALYSIS` / `AI_MODEL_ANALYSIS_FALLBACKS` sang endpoint model mới

## Liên kết code hiện tại

- Prompt runtime: `src/lib/services/agent.ts` → `synthesizeWithLlm`
- Validation: `src/lib/ai/validate.ts`
- Gateway: `src/lib/ai/gateway.ts`

Sau khi train xong, **không cần** thay prompt nhiều — model đã nội hóa giọng; vẫn giữ anti-hallucination gate.
