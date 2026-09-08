#!/usr/bin/env python3
"""
Tầng 4b — DPO từ agent_feedback (correctedAnswer)
"""
import argparse, json
from pathlib import Path

def parse_args():
    p = argparse.ArgumentParser(description="DPO Qwen3.8-27b")
    p.add_argument("--base", required=True, help="sft adapter dir")
    p.add_argument("--data", required=True, help="dpo.jsonl (prompt/chosen/rejected)")
    p.add_argument("--output", required=True)
    return p.parse_args()

def main():
    args = parse_args()
    print(f"[dpo] base={args.base} data={args.data} -> {args.output}")
    print("pip install trl && python -m trl.dpo --model_name {base} --dataset {data} --output_dir {out}".format(base=args.base, data=args.data, out=args.output))
    Path(args.output).mkdir(parents=True, exist_ok=True)
    print("[done] template")

if __name__ == "__main__":
    main()
