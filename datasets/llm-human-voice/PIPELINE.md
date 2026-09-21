# Pipeline: Thu thập → Annotate → Train → Deploy

## 1. Thu thập seed từ production ORCA

```bash
# Pseudo — log agent answers khi mode=llm
# Lưu: question, built.narrative, built.contract, answer, prefs.depth, model
```

Nguồn tốt:
- Log `/api/v1/agent` (question + response + context hash)
- Câu hỏi mẫu từ `AI_STOCK_GUIDE.md`, `AI_MARKET_GUIDE.md`, …
- Synthetic: lấy contract thật từ engines → viết question cố định

## 2. Annotation workflow

Với mỗi sample:

1. Chạy `validateOutput(answer, facts)` — nếu fail, sửa preferred hoặc loại
2. Viết **preferred** theo checklist:
   - [ ] Có chuyển tiếp tự nhiên
   - [ ] Mỗi số có ý nghĩa
   - [ ] Đúng depth
   - [ ] Không meta-talk
   - [ ] Không khuyến nghị cứng
3. Tạo **rejected** bằng một trong:
   - Bản LLM cũ (trước prompt v2) nếu còn log
   - Bản “làm xấu” có chủ đích: bỏ diễn giải, thêm cụm máy móc, cắt ngắn
   - Bản temperature cao bị lan man / hơi lệch số (để DPO tránh)

Tool gợi ý: spreadsheet hoặc Label Studio; export JSONL.

## 3. Train (gợi ý stack)

### SFT (QLoRA)

```text
Base: Qwen2.5-14B / 32B Instruct hoặc model analysis hiện tại
LoRA rank: 16–64
Epochs: 1–3
LR: 1e-4 … 2e-5
Max seq: 4096–8192 (context + answer)
```

Prompt format train (chat):

```
System: (có thể rút gọn so với runtime — model sẽ nội hóa style)
User: CÂU HỎI: ...
NARRATIVE: ...
CONTEXT JSON: ...
Assistant: {preferred_answer}
```

### DPO / ORPO

- Cùng base sau SFT nhẹ, hoặc train DPO trực tiếp
- Beta DPO ~0.1–0.5
- preferred / rejected cùng prompt prefix

## 4. Eval trước khi deploy

Bộ eval cố định 30–50 câu (không leak vào train):

| Metric | Cách đo |
|--------|--------|
| Numeric fidelity | `validateOutput` pass rate ≥ 98% |
| Length by depth | median tokens trong band |
| Style score | human 1–5 hoặc LLM-as-judge (có rubric) |
| No-advice rate | regex / classifier “mua/bán ngay” = 0 |
| Latency | p95 với max_tokens deep |

## 5. Deploy vào ORCA

1. Host model (vLLM / OpenRouter private / Groq custom — tùy)
2. Env:
   ```bash
   AI_MODEL_ANALYSIS=your-org/orca-analyst-v1
   AI_MODEL_ANALYSIS_FALLBACKS=inclusionai/ling-3.0-flash-fin:free,qwen/qwen3.8-27b:free
   ```
3. Giữ nguyên `validate.ts` + cascade gateway
4. A/B: 10–20% traffic → so sánh human rating

## 6. Vòng lặp

Production log (chỉ khi user không opt-out) → sample thêm preferred (human edit) → retrain quarterly.
