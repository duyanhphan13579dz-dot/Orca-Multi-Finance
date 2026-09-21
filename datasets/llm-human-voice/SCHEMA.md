# Schema chi tiết — ORCA LLM Human-Voice Dataset

## SFT record

| Field | Type | Required | Mô tả |
|-------|------|----------|--------|
| `id` | string | yes | Unique, format `{sft\|dpo}-{branch}-{nnn}` |
| `branch` | enum | yes | `market` \| `stock` \| `industry` \| `commodity` \| `compare` \| `general` |
| `depth` | enum | yes | `concise` \| `standard` \| `deep` |
| `language` | enum | yes | `vi` \| `en` (phase 1 ưu tiên `vi`) |
| `question` | string | yes | Câu hỏi user tự nhiên |
| `context_narrative` | string | yes | Đoạn NARRATIVE quant (như agent build) |
| `context_contract` | object | yes | JSON contract quant (số liệu structured) |
| `preferred_answer` | string | yes | Câu trả lời mục tiêu (human-like) |
| `meta` | object | no | `{ annotator, source_session_id, created_at, notes }` |

## DPO record

Giống SFT, thêm:

| Field | Type | Required |
|-------|------|----------|
| `preferred` | string | yes (thay preferred_answer) |
| `rejected` | string | yes |

## Hard filters

1. Numeric claims in preferred must trace to context_contract
2. No absolute buy/sell advice
3. Length bands by depth
4. Rejected must differ clearly from preferred
