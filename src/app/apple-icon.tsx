import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Apple touch icon */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#060d1d",
          borderRadius: 36,
        }}
      >
        <svg width="140" height="140" viewBox="0 0 64 64">
          <circle
            cx="32"
            cy="32"
            r="18"
            fill="none"
            stroke="#38bdf8"
            strokeWidth="2.2"
            opacity="0.9"
          />
          <ellipse cx="32" cy="36" rx="12" ry="9" fill="#38bdf8" />
          <path d="M30 14 L36 27 L24 27 Z" fill="#22d3ee" />
          <circle cx="37" cy="34" r="2.2" fill="#060d1d" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
