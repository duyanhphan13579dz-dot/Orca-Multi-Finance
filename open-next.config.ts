import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext Cloudflare adapter config.
 *
 * Caching (R2/KV) can be enabled later — see:
 * https://opennext.js.org/cloudflare/caching
 *
 * Note: playwright is CLI-only (ssc:crawl). pg uses pg-cloudflare under
 * workerd when nodejs_compat is enabled in wrangler.jsonc.
 */
export default defineCloudflareConfig({
  // No incremental cache binding yet — app still works; add R2/KV when ready.
});
