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

Có thể giữ `preferred_answer` = `preferred` để tool dùng chung.

## context_contract — ví dụ tối thiểu theo nhánh

### market
```json
{
  "vnIndex": { "last": 1285.4, "changePercent": 0.82, "volume": 812e9 },
  "breadth": { "advancers": 318, "decliners": 176 },
  "foreign": { "net": -248e9, "unit": "VND" },
  "sectors": [{ "name": "Ngân hàng", "changePercent": 1.4 }],
  "asOf": "2026-09-20T07:30:00+07:00"
}
```

### stock
```json
{
  "symbol": "FPT",
  "quote": { "price": 112500, "changePercent": 1.2 },
  "technical": { "rsi14": 58.2, "trend": "up" },
  "valuation": { "pe": 22.1, "pb": 4.8 },
  "financials": { "period": "Q2/2026", "revenue": 1.52e13, "source": "VNStock" }
}
```

### commodity
```json
{
  "name": "Vàng",
  "price": 2485.2,
  "unit": "USD/oz",
  "changePercent": 0.6,
  "asOf": "2026-09-20T08:00:00Z",
  "source": "simplize"
}
```

## rejected — các lỗi điển hình cần “dạy tránh”

1. **Robotic list**: chỉ bullet số, không diễn giải
2. **Meta talk**: “Dựa trên CONTEXT JSON…”, “Theo dữ liệu được cung cấp…”
3. **Hallucination nhẹ**: số không có trong contract
4. **Quá ngắn** so với depth=deep
5. **Khuyến nghị cứng**: “Nên mua FPT ngay”
6. **Trộn kỳ báo cáo** hoặc thiếu nguồn khi nêu financials

## File format

- Encoding: UTF-8
- JSONL: một object / dòng
- Số lớn: giữ nguyên number trong contract
