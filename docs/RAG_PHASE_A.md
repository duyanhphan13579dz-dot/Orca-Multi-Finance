# ORCA — Phase A (HOÀN THÀNH trên main)

## Checklist Phase A

| Hạng mục | Status |
|----------|--------|
| `src/lib/rag/*` lexical retrieve | ✅ |
| Guides corpus (market/stock/industry/commodity) | ✅ |
| News + `rag_chunks` retrieve | ✅ |
| `agent-synthesize.ts` inject TÀI LIỆU TRUY XUẤT | ✅ |
| `agent.ts` full intent router | ✅ |
| Schema `rag_chunks` + Neon table | ✅ (user SQL Editor) |
| Human-like prompt + validate | ✅ |
| Không train LLM | ✅ (đúng thiết kế A) |

## Phase B (đã mở)

Xem **[docs/RAG_PHASE_B.md](./RAG_PHASE_B.md)** — dataset RAG-SFT/DPO, format chat, QLoRA + vLLM + `AI_BASE_URL`.

## Phase C (sau)

pgvector / embedding / A/B traffic.
