# ORCA — Lộ trình RAG / Train (Phase A đã triển khai code)

## Mục tiêu Phase A (không train LLM)

1. Giữ **quant engines** làm nguồn số liệu chính (structured RAG).
2. Thêm **document RAG lexical**: AI guides + news DB + bảng `rag_chunks`.
3. Gắn passages vào `synthesizeWithLlm` (agent).
4. Giữ anti-hallucination `validate.ts` + prompt human-like.

## Đã thêm trong repo

| Path | Vai trò |
|------|---------|
| `src/lib/rag/*` | chunk, guides corpus, retrieve, format prompt |
| `src/db/schema.ts` → `rag_chunks` | Lưu note/BCTC text (chưa cần pgvector) |
| `src/lib/services/agent.ts` | Gọi `retrieveRag` trước khi LLM |

## Vận hành

```bash
npx drizzle-kit push
```

Guides đã embed trong code. News lấy từ bảng `news` nếu có DB.

## Phase B

Base Qwen2.5/3-Instruct + SFT/DPO format RAG → vLLM → `AI_BASE_URL`.

## Phase C

pgvector, embedding, A/B, BCTC PDF có chọn lọc.
