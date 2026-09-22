# Train QLoRA ORCA Analyst (Phase B)

## Colab

```python
!pip install -U transformers peft trl bitsandbytes accelerate datasets

from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
import torch

base = "Qwen/Qwen2.5-14B-Instruct"  # hoặc 7B trên T4
bnb = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_compute_dtype=torch.bfloat16)
model = AutoModelForCausalLM.from_pretrained(base, quantization_config=bnb, device_map="auto")
tok = AutoTokenizer.from_pretrained(base, trust_remote_code=True)

from peft import LoraConfig, get_peft_model
peft_cfg = LoraConfig(r=32, lora_alpha=16, lora_dropout=0.05, target_modules="all-linear", task_type="CAUSAL_LM")
model = get_peft_model(model, peft_cfg)

from datasets import load_dataset
ds = load_dataset("json", data_files="sft_rag_chat.jsonl", split="train")
# SFTTrainer (trl) — 1–3 epoch, lr 1e-4 … 2e-5
# model.save_pretrained("orca-analyst-lora")
```

## vLLM

```bash
vllm serve Qwen/Qwen2.5-14B-Instruct \
  --enable-lora \
  --lora-modules orca-analyst-v1=./orca-analyst-lora \
  --host 0.0.0.0 --port 8000
```

## ORCA env

```bash
AI_BASE_URL=http://YOUR_HOST:8000/v1
AI_MODEL_ANALYSIS=orca-analyst-v1
AI_MODEL_ANALYSIS_FALLBACKS=qwen/qwen3.8-27b:free,inclusionai/ling-3.0-flash-fin:free
OPENROUTER_API_KEY=...
```

| Param | Value |
|-------|-------|
| LoRA r | 16–64 |
| Epochs | 1–3 |
| LR | 1e-4 → 2e-5 |
| Max seq | 4096–8192 |
