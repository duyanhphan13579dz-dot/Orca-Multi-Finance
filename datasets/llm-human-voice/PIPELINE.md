# Pipeline: Thu thập → Annotate → Train → Deploy

## 1. Thu thập seed từ production ORCA

Log agent answers khi mode=llm: question, built.narrative, built.contract, answer, prefs.depth, model.

Nguồn tốt:
- Log `/api/v1/agent`
- Câu hỏi mẫu từ AI_*_GUIDE.md
- Synthetic: contract thật từ engines + question cố định

## 2. Annotation

1. validateOutput(answer, facts)
2. Viết preferred theo checklist (chuyển tiếp tự nhiên, số có ý nghĩa, đúng depth, không meta-talk, không advice cứng)
3. Tạo rejected: bản cũ / làm xấu có chủ đích

## 3. Train

SFT QLoRA trên base analysis model; hoặc DPO/ORPO với preferred vs rejected.

## 4. Eval

Numeric fidelity ≥ 98%, length by depth, style score, no-advice rate, latency.

## 5. Deploy

```bash
AI_MODEL_ANALYSIS=your-org/orca-analyst-v1
AI_MODEL_ANALYSIS_FALLBACKS=inclusionai/ling-3.0-flash-fin:free,qwen/qwen3.8-27b:free
```

Giữ validate.ts + cascade gateway. A/B 10–20% traffic.
