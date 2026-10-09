#!/usr/bin/env bash
# Ratchet: số lỗi TypeScript không được tăng so với baseline (.tsc-baseline). Giảm thì cập nhật baseline.
set -u
out=$(pnpm exec tsc --noEmit 2>&1); n=$(printf '%s\n' "$out" | grep -c 'error TS')
base=$(cat .tsc-baseline 2>/dev/null || echo 0)
echo "tsc errors: $n (baseline $base)"
if [ "$n" -gt "$base" ]; then printf '%s\n' "$out" | grep 'error TS' | head -30; echo "::error::Tăng lỗi TypeScript ($n > $base)"; exit 1; fi
[ "$n" -lt "$base" ] && echo "Giảm lỗi — hãy hạ .tsc-baseline xuống $n"
exit 0
