#!/usr/bin/env node
/**
 * Builds the OpenNext Cloudflare Worker bundle without touching pnpm-lock.yaml.
 *
 * Cloudflare CI runs:
 *   1) pnpm install --frozen-lockfile
 *   2) bun/pnpm run build   ← next build + this script
 *   3) npx wrangler deploy  ← expects .open-next/worker.js
 *
 * We install @opennextjs/cloudflare + pg-cloudflare with npm --no-save so the
 * frozen lockfile stays valid, then run the OpenNext adapter build.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function run(cmd, args, opts = {}) {
  console.log(`[cf-build-worker] $ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
    ...opts,
  });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

function hasPkg(name) {
  try {
    require.resolve(`${name}/package.json`);
    return true;
  } catch {
    return false;
  }
}

// Only needed when deploying to Cloudflare Workers (wrangler.jsonc present).
if (!existsSync("wrangler.jsonc") && !existsSync("wrangler.toml")) {
  console.log("[cf-build-worker] No wrangler config — skip OpenNext worker build.");
  process.exit(0);
}

if (!existsSync(".next")) {
  console.error("[cf-build-worker] .next missing — run `next build` first.");
  process.exit(1);
}

const need = [];
if (!hasPkg("@opennextjs/cloudflare")) need.push("@opennextjs/cloudflare@1.20.7");
if (!hasPkg("pg-cloudflare")) need.push("pg-cloudflare@1.2.7");

if (need.length) {
  // --no-save: do not rewrite package.json / lockfile (frozen-lockfile CI).
  run("npm", ["install", "--no-save", "--no-package-lock", "--legacy-peer-deps", ...need]);
}

// Prefer local bin after install; fall back to npx.
let bin = null;
try {
  bin = require.resolve("@opennextjs/cloudflare/package.json");
  // package bin is opennextjs-cloudflare
} catch {
  /* handled below */
}

if (bin) {
  run("npx", ["opennextjs-cloudflare", "build"]);
} else {
  run("npx", ["--yes", "@opennextjs/cloudflare@1.20.7", "build"]);
}

if (!existsSync(".open-next/worker.js")) {
  console.error("[cf-build-worker] Expected .open-next/worker.js after OpenNext build.");
  process.exit(1);
}

console.log("[cf-build-worker] OpenNext worker ready → .open-next/worker.js");
