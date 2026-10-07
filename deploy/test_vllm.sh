#!/usr/bin/env bash
set -euo pipefail
BASE="${1:-http://127.0.0.1:8000/v1}"
MODEL="${2:-orca-analyst-v1}"
echo "Models:"
curl -sS "$BASE/models" | head -c 500
echo ""
echo "Chat:"
curl -sS "$BASE/chat/completions" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL\",
    \"messages\": [
      {\"role\": \"system\", \"content\": \"Bạn là ORCA Agent. Chỉ dùng số trong context. Không advice mua/bán.\"},
      {\"role\": \"user\", \"content\": \"CÂU HỎI: VN-Index thế nào?\\n\\nNARRATIVE:\\nVN-Index 1285 (+0.8%), thanh khoản 800 tỷ.\\n\\nCONTEXT JSON:\\n{\\\"vnIndex\\\":{\\\"last\\\":1285,\\\"changePercent\\\":0.8}}\"}
    ],
    \"temperature\": 0.35,
    \"max_tokens\": 400
  }"
echo ""
