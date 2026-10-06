"use client";

import { useSettings } from "@/lib/settings";
import { Panel } from "@/components/ui";

export function AppModeSection() {
  const { settings, update } = useSettings();
  const mode = settings.app?.mode ?? "investment";

  return (
    <Panel className="mb-2" pad={false}>
      <header className="border-b border-border-subtle px-3 py-2">
        <h2 className="text-[13px] font-semibold text-text-primary">Chế độ ứng dụng</h2>
        <p className="mt-0.5 text-[10.5px] leading-snug text-text-muted">
          Đầu tư = Orca Multi Finance. Tài chính cá nhân = Orca Wallet.
        </p>
      </header>
      <div className="flex flex-col gap-2 p-3 sm:flex-row">
        <button
          type="button"
          onClick={() => {
            update({
              app: {
                mode: "investment",
                showModeToggleInHeader: settings.app?.showModeToggleInHeader ?? true,
              },
            });
            window.location.href = "/";
          }}
          className={`rounded-lg border px-3 py-2 text-left text-[12px] transition ${
            mode === "investment"
              ? "border-accent bg-accent/10 text-text-primary"
              : "border-border-subtle text-text-muted hover:border-border"
          }`}
        >
          <div className="font-semibold">Đầu tư</div>
          <div className="mt-0.5 text-[10.5px] opacity-80">Thị trường · danh mục · phái sinh</div>
        </button>
        <button
          type="button"
          onClick={() => {
            update({
              app: {
                mode: "personal_finance",
                showModeToggleInHeader: settings.app?.showModeToggleInHeader ?? true,
              },
            });
            window.location.href = "/pf";
          }}
          className={`rounded-lg border px-3 py-2 text-left text-[12px] transition ${
            mode === "personal_finance"
              ? "border-accent bg-accent/10 text-text-primary"
              : "border-border-subtle text-text-muted hover:border-border"
          }`}
        >
          <div className="font-semibold">Tài chính cá nhân</div>
          <div className="mt-0.5 text-[10.5px] opacity-80">Thu chi · thuế · mục tiêu · health score</div>
        </button>
      </div>
    </Panel>
  );
}
