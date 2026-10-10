import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Toàn bộ route của ORCA là `force-dynamic` + cache tầng ứng dụng (src/lib/cache.ts),
// nên không cần incremental cache (R2/KV) cho ISR. Cấu hình mặc định là đủ.
export default defineCloudflareConfig();
