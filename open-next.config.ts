/**
 * OpenNext Cloudflare adapter config.
 * Loaded only by `opennextjs-cloudflare` CLI (not by `next build`).
 *
 * Caching (R2/KV): https://opennext.js.org/cloudflare/caching
 */
// Use dynamic import style compatible when package is npm --no-save installed.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({
  // No incremental cache binding yet — add R2/KV when ready.
});
