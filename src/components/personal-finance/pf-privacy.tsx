"use client";

import { useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui";
import {
  wipeAllUserData,
  loadSnapshotsFromStorage,
  loadProfileFromStorage,
  exportDataAsJson,
} from "@/lib/personal-finance/storage";
import { pullPfFromServer, pushPfToServer } from "@/lib/personal-finance/sync";

export function PfPrivacy() {
  const [msg, setMsg] = useState<string | null>(null);

  const exportJson = () => {
    const json = exportDataAsJson(loadProfileFromStorage(), loadSnapshotsFromStorage());
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orca-pf-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg("Đã tải file JSON.");
  };

  const wipe = () => {
    if (!confirm("Xóa toàn bộ dữ liệu tài chính cá nhân trên thiết bị này?")) return;
    wipeAllUserData();
    setMsg("Đã xóa profile + snapshots + assumptions + goals trên localStorage.");
  };

  return (
    <div className="mx-auto max-w-2xl space-y-3 p-3 sm:p-4">
      <Link href="/pf" className="text-[11px] text-accent underline">
        ← Tổng quan PF
      </Link>
      <h1 className="text-[17px] font-semibold text-text-primary">Riêng tư & dữ liệu</h1>
      <Panel className="space-y-3 p-4 text-[12px]">
        <p className="text-text-muted">
          Local-first (<code>orca_fin_*</code>). Khi đăng nhập, có thể đồng bộ lên server
          (`/api/v1/pf`).
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={async () => {
              const r = await pushPfToServer();
              setMsg(r.ok ? "Đã đẩy lên server." : `Push lỗi: ${r.error}`);
            }}
            className="rounded-lg border border-border-subtle px-3 py-1.5"
          >
            Đồng bộ lên server
          </button>
          <button
            type="button"
            onClick={async () => {
              const r = await pullPfFromServer();
              setMsg(
                r.ok
                  ? r.applied
                    ? "Đã kéo từ server (áp dụng)."
                    : "Server không mới hơn local."
                  : `Pull lỗi: ${r.error}`,
              );
            }}
            className="rounded-lg border border-border-subtle px-3 py-1.5"
          >
            Kéo từ server
          </button>
          <button
            type="button"
            onClick={exportJson}
            className="rounded-lg border border-border-subtle px-3 py-1.5"
          >
            Xuất JSON
          </button>
          <button
            type="button"
            onClick={wipe}
            className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-rose-300"
          >
            Xóa toàn bộ dữ liệu PF
          </button>
        </div>
        {msg && <p className="text-accent">{msg}</p>}
      </Panel>
    </div>
  );
}
