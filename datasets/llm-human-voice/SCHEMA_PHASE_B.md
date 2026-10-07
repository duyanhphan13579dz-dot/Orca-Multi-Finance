# Schema Phase B — RAG-aware SFT / DPO

## Field mới

| Field | Type | Mô tả |
|-------|------|--------|
| `retrieved` | array | Đoạn giống runtime `retrieveRag` |
| `retrieved[].id` | string | |
| `retrieved[].source` | guide\|news\|note\|bctc | |
| `retrieved[].title` | string | |
| `retrieved[].content` | string | |

## Chat format

System + User (CÂU HỎI + NARRATIVE + CONTEXT JSON + TÀI LIỆU TRUY XUẤT) + Assistant (preferred).
