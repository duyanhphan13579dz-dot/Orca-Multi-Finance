import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Cho phép `next dev` truy cập binding Cloudflare (env/vars) giống production.
initOpenNextCloudflareForDev();

// Áp cho cả response SSR/API do Worker sinh ra (public/_headers chỉ phủ static assets).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  // Strict TS verification: 0 errors across entire codebase (.tsc-baseline: 0)
  typescript: { ignoreBuildErrors: false },
  output: "standalone",
  // Keep heavy Node-only packages out of the Next server bundle.
  // pg-cloudflare must travel with pg — OpenNext/esbuild resolves it from pg/lib/stream.js.
  serverExternalPackages: ["pg", "pg-cloudflare", "playwright", "playwright-core"],
  // Cloudflare Workers (OpenNext): `pg` loads `pg-cloudflare` for TCP sockets via the
  // "workerd" export condition, but Next traces with the default condition and would
  // copy only `dist/empty.js`. Force the real entry files into the trace for both
  // bun (flat node_modules) and pnpm layouts.
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/pg-cloudflare/dist/**/*",
      "./node_modules/pg-cloudflare/esm/**/*",
      "./node_modules/pg-cloudflare/package.json",
      "./node_modules/.pnpm/pg-cloudflare@*/node_modules/pg-cloudflare/{dist,esm,package.json}/**/*",
    ],
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "lightweight-charts"],
    // Giới hạn worker khi "Collecting page data" — môi trường build bị giới hạn ~2GB RAM
    // (64 CPU × workers mỗi cái một process Node sẽ OOM kill ở bước collect page data).
    cpus: 2,
  },
  poweredByHeader: false,
  compress: true,
  images: {
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [
      {
        source: "/:path*(svg|jpg|jpeg|png|webp|avif|ico|css|js|woff|woff2)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
          { key: "Content-Security-Policy", value: CSP },
        ],
      },
    ];
  },
};

export default nextConfig;
