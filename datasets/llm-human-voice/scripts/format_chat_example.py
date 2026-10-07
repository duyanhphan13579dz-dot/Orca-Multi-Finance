#!/usr/bin/env python3
"""Convert ORCA SFT RAG JSONL → chat messages for QLoRA (trl / axolotl)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

SYSTEM = """Bạn là ORCA Agent — trợ lý phân tích tài chính.
Chỉ dùng số liệu trong CONTEXT/NARRATIVE và TÀI LIỆU TRUY XUẤT.
Không bịa số, không khuyến nghị mua/bán tuyệt đối.
Giọng senior equity research analyst Việt Nam."""


def format_retrieved(retrieved: list) -> str:
    if not retrieved:
        return "(Không có đoạn tài liệu bổ sung.)"
    parts = []
    for i, p in enumerate(retrieved, 1):
        parts.append(
            f"[{i}] source={p.get('source','?')} {p.get('title','')}\n{p.get('content','')}"
        )
    return "\n\n".join(parts)


def to_messages(rec: dict) -> dict:
    q = rec["question"]
    narrative = rec.get("context_narrative") or ""
    contract = rec.get("context_contract") or {}
    retrieved = rec.get("retrieved") or []
    answer = rec.get("preferred_answer") or rec.get("preferred") or ""
    user = (
        f"CÂU HỎI: {q}\n\n"
        f"NARRATIVE HỆ THỐNG:\n{narrative[:10000]}\n\n"
        f"CONTEXT JSON (rút gọn):\n{json.dumps(contract, ensure_ascii=False)[:12000]}\n\n"
        f"TÀI LIỆU TRUY XUẤT:\n{format_retrieved(retrieved)}\n\n"
        "Hãy tổng hợp phân tích chuyên sâu, bám số liệu quant và tài liệu trên."
    )
    return {
        "id": rec.get("id"),
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": user},
            {"role": "assistant", "content": answer},
        ],
    }


def main(paths: list[str], out: str) -> None:
    rows = []
    for p in paths:
        for line in Path(p).read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            rows.append(to_messages(json.loads(line)))
    Path(out).write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {len(rows)} chat examples → {out}")


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) < 2:
        print("Usage: format_chat_example.py out.jsonl in1.jsonl [in2.jsonl ...]")
        sys.exit(1)
    main(args[1:], args[0])
