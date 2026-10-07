# ORCA — Deploy vLLM + LoRA finance

## LoRA tối ưu tài chính

| Param | Value | Lý do |
|-------|-------|--------|
| r | **32** | Format CONTEXT + số + giọng analyst |
| alpha | **64** | ~2×r |
| dropout | 0.05 | Tránh overfit |
| target_modules | q/k/v/o + gate/up/down | Attention + MLP |
| lr | 1.5e-4 | 1e-4 nếu >300 mẫu |
| epochs | 2–3 | Tránh nhồi cứng |
| gen temperature | **0.35** | Fidelity số liệu |

Xem `configs/lora_finance.yaml`.

## Serve

```bash
unzip orca-analyst-lora.zip
export LORA_PATH=./orca-analyst-lora
chmod +x deploy/vllm_serve.sh
./deploy/vllm_serve.sh
```

Docker: `docker compose -f deploy/docker-compose.vllm.yml up -d`

## Test

```bash
chmod +x deploy/test_vllm.sh
./deploy/test_vllm.sh http://127.0.0.1:8000/v1 orca-analyst-v1
```

## ORCA `.env`

```bash
AI_BASE_URL=https://YOUR_HOST/v1
AI_API_KEY=sk-local
AI_MODEL_ANALYSIS=orca-analyst-v1
AI_MODEL_ANALYSIS_FALLBACKS=qwen/qwen3.8-27b:free,inclusionai/ling-3.0-flash-fin:free
OPENROUTER_API_KEY=sk-or-v1-...
```

Gateway đã hỗ trợ OpenAI-compatible `AI_BASE_URL`.
