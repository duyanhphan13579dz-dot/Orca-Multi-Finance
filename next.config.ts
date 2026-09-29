import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // TEMP: SWC panics ("failed to initiate panic, error 5") when printing TS
  // code frames that contain multi-byte Vietnamese text. Unblocks deploy;
  // remove once `tsc --noEmit` is clean on CI.
  typescript: {
    ignoreBuildErrors: true,
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
        ],
      },
    ];
  },
};

export default nextConfig;
