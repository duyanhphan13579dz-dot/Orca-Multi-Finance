import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack is used in Next 16 builds; keep config compatible with both bundlers.
  // Previously a custom `webpack.splitChunks` was added for micro-optimization,
  // but it breaks `next build --turbopack`. Turbopack's defaults are already
  // highly optimized, and the real perf wins come from data-layer caching
  // (cache.ts, SWR dedup) and UI virtualization - not manual chunk tuning.
  turbopack: {},
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts", "date-fns"],
  },
  poweredByHeader: false,
  compress: true,
  reactStrictMode: true,
  productionBrowserSourceMaps: false,
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 30,
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
        // Cache API responses at CDN edge for short period (SWR) - reduces origin load
        // Actual freshness controlled by application cache layer with stale-while-revalidate
        source: "/api/v1/:path*",
        headers: [
          { key: "Cache-Control", value: "public, s-maxage=10, stale-while-revalidate=30" },
          { key: "CDN-Cache-Control", value: "public, s-maxage=10, stale-while-revalidate=30" },
          { key: "Vercel-CDN-Cache-Control", value: "public, s-maxage=10, stale-while-revalidate=30" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
    ];
  },
};

export default nextConfig;
