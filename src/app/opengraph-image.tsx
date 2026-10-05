import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "ORCA Financial — Nền tảng đầu tư thông minh";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social / link preview image */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "64px 72px",
          background: "linear-gradient(135deg, #060d1d 0%, #0d1528 55%, #0a1628 100%)",
          color: "#e8eefc",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28, marginBottom: 36 }}>
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: 22,
              background: "#060d1d",
              border: "2px solid #38bdf8",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="64" height="64" viewBox="0 0 64 64">
              <ellipse cx="32" cy="36" rx="14" ry="10" fill="#38bdf8" />
              <path d="M30 12 L38 28 L22 28 Z" fill="#22d3ee" />
              <circle cx="38" cy="34" r="2.6" fill="#060d1d" />
            </svg>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 52, fontWeight: 800, letterSpacing: "-0.02em", color: "#e8eefc" }}>
              ORCA Financial
            </div>
            <div style={{ fontSize: 24, color: "#9aadc8", marginTop: 6 }}>
              Nền tảng đầu tư thông minh
            </div>
          </div>
        </div>
        <div style={{ fontSize: 28, color: "#9aadc8", maxWidth: 900, lineHeight: 1.45 }}>
          Cổ phiếu Việt Nam · Tiền mã hóa · Ngoại hối · Hàng hóa · Tin tức · AI nghiên cứu
        </div>
        <div
          style={{
            marginTop: 48,
            display: "flex",
            gap: 12,
            fontSize: 18,
            color: "#38bdf8",
            fontWeight: 600,
          }}
        >
          <span style={{ padding: "8px 16px", borderRadius: 999, border: "1px solid #243556" }}>
            Realtime
          </span>
          <span style={{ padding: "8px 16px", borderRadius: 999, border: "1px solid #243556" }}>
            Phân tích kỹ thuật
          </span>
          <span style={{ padding: "8px 16px", borderRadius: 999, border: "1px solid #243556" }}>
            Screener
          </span>
        </div>
      </div>
    ),
    { ...size },
  );
}
