"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const msg = (error as Error)?.message ?? "";
  const isChunk = /ChunkLoadError|Loading chunk|Failed to fetch.*chunk/i.test(msg);
  const digest = (error as { digest?: string })?.digest ?? "unknown";

  const hardReload = () => {
    try {
      window.location.reload();
    } catch {
      reset();
    }
  };
  const clearAndReload = () => {
    try {
      const keys = ["orca.settings.v1", "orca.watchlist.v1", "orca.journal.v1", "orca.sidebar.collapsed"];
      for (const k of keys) localStorage.removeItem(k);
      sessionStorage.clear();
    } catch {}
    try {
      window.location.reload();
    } catch {
      reset();
    }
  };

  return (
    <html lang="vi">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#060d1d", color: "#e8eef8" }}>
        <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
          <div style={{ maxWidth: 520 }}>
            <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: "0.14em", textTransform: "uppercase" }}>ORCA Financial</div>
            <h1 style={{ fontSize: 18, margin: "8px 0" }}>{isChunk ? "Đã có bản cập nhật mới" : "ORCA tạm gián đoạn"}</h1>
            <p style={{ fontSize: 13, opacity: 0.75, marginBottom: 8, lineHeight: 1.6 }}>
              {isChunk
                ? "Ứng dụng vừa được triển khai phiên bản mới. Trình duyệt đang giữ bản cũ trong cache — tải lại để đồng bộ. Dữ liệu và cài đặt của bạn vẫn an toàn."
                : "Ứng dụng gặp lỗi ngoài dự kiến ở lớp khung (thường do bộ nhớ cục bộ cũ bị hỏng sau cập nhật). Bấm Tải lại để khôi phục ngay."}
            </p>
            <p style={{ fontSize: 11, opacity: 0.5, marginBottom: 16, wordBreak: "break-all" }}>
              Mã: {digest} · {msg ? msg.slice(0, 160) : "unknown"} · Nếu cứ lặp lại, dùng nút “Xóa bộ nhớ tạm & tải lại” bên dưới.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => reset()}
                style={{
                  border: 0,
                  borderRadius: 999,
                  padding: "10px 18px",
                  background: "#2dd4bf",
                  color: "#042f2e",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Tải lại
              </button>
              <button
                type="button"
                onClick={hardReload}
                style={{
                  border: "1px solid #1e3a5f",
                  borderRadius: 999,
                  padding: "10px 14px",
                  background: "#0f1e3d",
                  color: "#a3b4cf",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Tải lại cứng (Ctrl+F5)
              </button>
              <button
                type="button"
                onClick={clearAndReload}
                style={{
                  border: "1px solid rgba(238,95,117,0.35)",
                  borderRadius: 999,
                  padding: "10px 14px",
                  background: "rgba(238,95,117,0.12)",
                  color: "#ee5f75",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Xóa bộ nhớ tạm & tải lại
              </button>
            </div>
            <p style={{ fontSize: 10, opacity: 0.45, marginTop: 12 }}>
              Lỗi “unknown” lặp lại sau khi xóa thường do mạng chặn chunk mới — thử đổi mạng hoặc mở tab ẩn danh.
            </p>
          </div>
        </div>
      </body>
    </html>
  );
}
