import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { join, resolve } from "path";

const ROOT = resolve(__dirname, "..", "..", "..");
const NEEDLE = ["vn", "stock"].join(""); // không để literal trong file test

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === "node_modules" || e === ".next" || e === ".git") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

test("VNStock removal: không còn provider/service deprecated files", () => {
  assert.equal(existsSync(join(ROOT, "src/lib/providers/vnstock.ts")), false);
  assert.equal(existsSync(join(ROOT, "src/lib/reconcile.ts")), false);
});

test("VNStock removal: không còn reference trong src/ (import, env, comment, dead code)", () => {
  const SELF = join(ROOT, "src/lib/__tests__/vnstock-removed.test.ts");
  const hits: string[] = [];
  for (const f of walk(join(ROOT, "src"))) {
    if (f === SELF) continue; // chính file test phải chứa chuỗi khẳng định
    if (!/\.(ts|tsx|js|jsx|json)$/.test(f)) continue;
    const text = readFileSync(f, "utf8");
    if (text.toLowerCase().includes(NEEDLE.toLowerCase())) hits.push(f);
  }
  assert.deepEqual(hits, [], `Còn reference VNStock trong: ${hits.join(", ")}`);
});

test("VNStock removal: không còn env vars trong .env.example", () => {
  const envFile = join(ROOT, ".env.example");
  assert.equal(existsSync(envFile), true);
  const text = readFileSync(envFile, "utf8");
  assert.equal(/VNSTOCK_/i.test(text), false);
});

test("VNStock removal: không còn reference trong docs + README", () => {
  const hits: string[] = [];
  for (const f of walk(join(ROOT, "docs"))) {
    if (!/\.md$/.test(f)) continue;
    const text = readFileSync(f, "utf8");
    if (text.toLowerCase().includes(NEEDLE.toLowerCase())) hits.push(f);
  }
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  if (readme.toLowerCase().includes(NEEDLE.toLowerCase())) hits.push("README.md");
  assert.deepEqual(hits, [], `Còn reference VNStock trong docs: ${hits.join(", ")}`);
});
