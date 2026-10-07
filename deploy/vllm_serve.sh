#!/usr/bin/env bash
# ORCA Analyst — vLLM serve (OpenAI-compatible)
set -euo pipefail

BASE_MODEL="${BASE_MODEL:-Qwen/Qwen2.5-7B-Instruct}"
LORA_PATH="${LORA_PATH:-./orca-analyst-lora}"
LORA_NAME="${LORA_NAME:-orca-analyst-v1}"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"
MAX_MODEL_LEN="${MAX_MODEL_LEN:-4096}"
GPU_MEM_UTIL="${GPU_MEM_UTIL:-0.90}"
DTYPE="${DTYPE:-auto}"

if [[ ! -d "$LORA_PATH" ]]; then
  echo "ERROR: LORA_PATH not found: $LORA_PATH"
  exit 1
fi

echo "=== ORCA vLLM ==="
echo "base: $BASE_MODEL | lora: $LORA_NAME <= $LORA_PATH | $HOST:$PORT"

exec python -m vllm.entrypoints.openai.api_server \
  --model "$BASE_MODEL" \
  --enable-lora \
  --lora-modules "${LORA_NAME}=${LORA_PATH}" \
  --host "$HOST" \
  --port "$PORT" \
  --max-model-len "$MAX_MODEL_LEN" \
  --gpu-memory-utilization "$GPU_MEM_UTIL" \
  --dtype "$DTYPE" \
  --trust-remote-code \
  --disable-log-requests
