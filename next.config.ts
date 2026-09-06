import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Never sniff responses as a different MIME type.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Stop sending the full URL (session/token leaks in referrers).
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Lean browser permissions — no camera/mic/geolocation by default.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // HSTS only when served over HTTPS in production.
          ...(process.env.NODE_ENV === "production"
            ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
