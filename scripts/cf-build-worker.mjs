#!/usr/bin/env node
/**
 * Builds the OpenNext Cloudflare Worker bundle without touching pnpm-lock.yaml.
 *
 * Cloudflare CI runs:
 *   1) pnpm install --frozen-lockfile
 *   2) bun/pnpm run build   ← next build + this script
 *   3) npx wrangler deploy  ← expects .open-next/worker.js
 *
 * Must NOT use `npm install` here: this repo is pnpm-managed and npm chokes on
 * `workspace:` protocol URLs inside the dependency tree (EUNSUPPORTEDPROTOCOL).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os"
;

const require = createRequire(import.meta.url);
const root = process.cwd();

function run(cmd, args, opts = {}) {
  console.log(`[cf-build-worker] $ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
    cwd: opts.cwd ?? root,
    ...opts,
  });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
  return r;
}

function hasPkg(name) {
  try {
    require.resolve(`${name}/package.json`, { paths: [root] });
    return true;
  } catch {
    return false;
  }
}

function whichPnpm() {
  const r = spawnSync("pnpm", ["--version"], { encoding: "utf8" });
  if (r.status === 0) return "pnpm";
  const r2 = spawnSync("corepack", ["pnpm", "--version"], { encoding: "utf8" });
  if (r2.status === 0) return "corepack pnpm";
  return null;
}

// Only needed when deploying to Cloudflare Workers (wrangler config present).
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
  const pnpm = whichPnpm();
  if (pnpm) {
    // Install into the existing node_modules without rewriting the lockfile.
    // --no-lockfile: do not read/write pnpm-lock.yaml (keeps frozen-lockfile valid).
    const cmd = pnpm.startsWith("corepack") ? "corepack" : "pnpm";
    const args = pnpm.startsWith("corepack")
      ? ["pnpm", "add", "--no-lockfile", "--prefer-offline", ...need]
      : ["add", "--no-lockfile", "--prefer-offline", ...need];
    run(cmd, args);
  } else {
    // Fallback: install into an isolated prefix, then expose via NODE_PATH.
    const vendor = join(tmpdir(), `orca-cf-vendor-${process.pid}`);
    rmSync(vendor, { recursive: true, force: true });
    mkdirSync(vendor, { recursive: true });
    run("npm", ["init", "-y"], { cwd: vendor });
    run(
      "npm",
      ["install", "--no-package-lock", "--legacy-peer-deps", ...need],
      { cwd: vendor },
    );
    process.env.NODE_PATH = [
      join(vendor, "node_modules"),
      process.env.NODE_PATH || "",
    ]
      .filter(Boolean)
      .join(":");
    // Re-register NODE_PATH for subsequent require.resolve / child processes.
    run("node", ["-e", "require('module').Module._initPaths()"]);
    console.log(`[cf-build-worker] Vendor deps at ${vendor}`);
  }
}

// Run OpenNext build (creates .open-next/worker.js).
if (hasPkg("@opennextjs/cloudflare")) {
  run("npx", ["opennextjs-cloudflare", "build"]);
} else {
  // Last resort: download & execute the CLI without a permanent install.
  run("npx", ["--yes", "@opennextjs/cloudflare@1.20.7", "build"]);
}

if (!existsSync(".open-next/worker.js")) {
  console.error("[cf-build-worker] Expected .open-next/worker.js after OpenNext build.");
  process.exit(1);
}

console.log("[cf-build-worker] OpenNext worker ready → .open-next/worker.js");
