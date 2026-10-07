"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="vi">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#060d1d", color: "#e8eef8" }}>
        <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
          <div>
            <h1 style={{ fontSize: 18, marginBottom: 8 }}>ORCA tạm gián đoạn</h1>
            <p style={{ fontSize: 13, opacity: 0.75, marginBottom: 16 }}>
              Ứng dụng cần tải lại. Mã: {error?.digest ?? "unknown"}
            </p>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                border: 0,
                borderRadius: 8,
                padding: "8px 14px",
                background: "#2dd4bf",
                color: "#042f2e",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Tải lại
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
