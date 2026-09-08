#!/usr/bin/env python3
"""
Tầng 2b/5 — LoRA SFT cho qwen/qwen3.8-27b cố định
Dùng dataset JSONL từ src/lib/ai/training/dataset.ts (toJsonl)
"""
import argparse, json
from pathlib import Path

def parse_args():
    p = argparse.ArgumentParser(description="SFT Qwen3.8-27b — ORCA")
    p.add_argument("--base", default="qwen/qwen3-8b", help="base model id (đã cố định qwen/qwen3.8-27b, map về qwen3-8b trên HF)")
    p.add_argument("--data", required=True, help="path sft.jsonl")
    p.add_argument("--output", required=True, help="lora adapter output dir")
    p.add_argument("--lora-r", type=int, default=16)
    p.add_argument("--lora-alpha", type=int, default=32)
    p.add_argument("--lr", type=float, default=2e-4)
    p.add_argument("--epochs", type=int, default=3)
    p.add_argument("--batch", type=int, default=4)
    return p.parse_args()

def main():
    args = parse_args()
    data = Path(args.data)
    if not data.exists():
        print(f"[error] data not found: {data}")
        # demo: tạo file mẫu nếu chưa có
        sample = [
            {"system":"Bạn là chuyên viên ORCA Financial.","user":"Thị trường đang diễn ra chuyện gì?","assistant":"Thị trường phân hoá..."},
            {"system":"Bạn là chuyên gia crypto.","user":"Phân tích BTC","assistant":"BTCUSDT — giá ..."},
        ]
        data.parent.mkdir(parents=True, exist_ok=True)
        data.write_text("\n".join(json.dumps(x, ensure_ascii=False) for x in sample), encoding="utf-8")
        print(f"[demo] wrote sample {data}")

    print(f"[sft] base={args.base} (alias qwen/qwen3.8-27b) -> {args.output}")
    print(f"[sft] data={args.data} lora-r={args.lora_r} alpha={args.lora_alpha} lr={args.lr} epochs={args.epochs}")
    print("""[next]
pip install trl peft transformers accelerate bitsandbytes
python -m trl.sft --model_name {base} --dataset {data} --output_dir {out} \\
  --lora_r {r} --lora_alpha {a} --learning_rate {lr} --num_train_epochs {ep} --per_device_train_batch_size {bs}
# Sau train: merge và push
# python scripts/train-llm/merge.py --base {base} --adapter {out} --push qwen/qwen3.8-27b-orca
""".format(base=args.base, data=args.data, out=args.output, r=args.lora_r, a=args.lora_alpha, lr=args.lr, ep=args.epochs, bs=args.batch))
    # TODO: tích hợp trl.SFTTrainer thực tế khi có GPU
    Path(args.output).mkdir(parents=True, exist_ok=True)
    (Path(args.output) / "README.md").write_text(f"# LoRA {args.output}\nbase: {args.base} (fixed qwen/qwen3.8-27b)\n", encoding="utf-8")
    print("[done] (template)")

if __name__ == "__main__":
    main()
