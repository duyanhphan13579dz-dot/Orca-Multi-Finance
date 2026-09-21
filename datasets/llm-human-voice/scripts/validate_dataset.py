#!/usr/bin/env python3
"""Lightweight QA for ORCA SFT/DPO JSONL — mirrors spirit of src/lib/ai/validate.ts."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

NUM_RE = re.compile(
    r"(-?\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?)\s*(%)?"
)

FORBIDDEN = [
    r"dựa trên dữ liệu được cung cấp",
    r"theo context json",
    r"nên mua ngay",
    r"nên bán ngay",
    r"khuyến nghị:\s*mua",
    r"khuyến nghị:\s*bán",
]


def parse_local_number(raw: str) -> float | None:
    s = re.sub(r"\s", "", raw)
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        if re.search(r",\d{1,2}$", s) and not re.search(r",\d{3}$", s):
            s = s.replace(",", ".")
        else:
            s = s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def extract_claims(text: str) -> list[tuple[str, float, bool]]:
    out = []
    for m in NUM_RE.finditer(text):
        v = parse_local_number(m.group(1))
        if v is None:
            continue
        out.append((m.group(0), v, bool(m.group(2))))
    return out


def collect_facts(obj, acc: set[float] | None = None) -> set[float]:
    if acc is None:
        acc = set()
    if obj is None:
        return acc
    if isinstance(obj, bool):
        return acc
    if isinstance(obj, (int, float)):
        if abs(obj) < 1e15:
            acc.add(float(f"{float(obj):.8g}"))
        return acc
    if isinstance(obj, list):
        for x in obj:
            collect_facts(x, acc)
        return acc
    if isinstance(obj, dict):
        for v in obj.values():
            collect_facts(v, acc)
        return acc
    return acc


def numeric_ok(text: str, contract: dict, tol: float = 0.05) -> tuple[bool, list[str]]:
    facts = collect_facts(contract)
    expanded = set(facts)
    for f in list(facts):
        af = abs(f)
        expanded.add(af)
        if af >= 1e8:
            expanded.add(af / 1e9)
            expanded.add(af / 1e6)
        if af >= 1e5:
            expanded.add(af / 1e3)
    facts = expanded
    bad = []
    for raw, val, _pct in extract_claims(text):
        abs_v = abs(val)
        if abs_v < 15 or 1900 <= abs_v <= 2100:
            continue
        if abs_v <= 31 and ("ngày" in text.lower() or "2026" in text or "2025" in text):
            continue
        ok = False
        for f in facts:
            if f == 0:
                continue
            rel = abs(val - f) / max(abs(f), 1e-9)
            if rel <= tol or (rel <= 0.12 and abs_v >= 1e2):
                ok = True
                break
        if not ok:
            bad.append(raw)
    return len(bad) == 0, bad


def style_ok(text: str) -> tuple[bool, list[str]]:
    low = text.lower()
    hits = [p for p in FORBIDDEN if re.search(p, low)]
    return len(hits) == 0, hits


def check_record(rec: dict, kind: str) -> list[str]:
    errs = []
    for k in ("id", "branch", "depth", "language", "question", "context_contract"):
        if k not in rec:
            errs.append(f"missing {k}")
    answer = rec.get("preferred_answer") or rec.get("preferred")
    if not answer:
        errs.append("missing preferred answer")
        return errs
    contract = rec.get("context_contract") or {}
    ok, bad = numeric_ok(answer, contract)
    if not ok:
        errs.append(f"unsupported numbers: {bad[:5]}")
    sok, hits = style_ok(answer)
    if not sok:
        errs.append(f"forbidden style: {hits}")
    if kind == "dpo" and not rec.get("rejected"):
        errs.append("missing rejected")
    return errs


def main(paths: list[str]) -> int:
    failed = 0
    for p in paths:
        path = Path(p)
        for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            kind = "dpo" if "rejected" in rec else "sft"
            errs = check_record(rec, kind)
            if errs:
                failed += 1
                print(f"{path.name}:{i} {rec.get('id', '?')}: {errs}")
            else:
                print(f"OK {rec.get('id')}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:] or ["samples/sft_train.jsonl", "samples/dpo_pairs.jsonl"]))
