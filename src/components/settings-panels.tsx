"use client";

import { useRef, useState } from "react";
import {
  useSettings,
  getSettingsSnapshot,
  updateSettings,
  DASHBOARD_WIDGETS,
  tradeFeePct,
  type UserSettings,
} from "@/lib/settings";
import { Badge, formatAge } from "@/components/ui";
import { useApi } from "@/lib/hooks";
import type { ProviderStatus } from "@/lib/types";
import { Row, Section, Seg, Switch } from "@/components/settings-panels-extra";
import {
  ArrowDown,
  ArrowUp,
  LogIn,
  MonitorSmartphone,
  ShieldCheck,
} from "lucide-react";

export { SystemTab } from "@/components/settings-system-tab";

/* ----------------------------- TRADING & FEES ----------------------------- */

export function TradingTab() {
  const { settings, update } = useSettings();
  const t = settings.trading;
  const set = (patch: Partial<typeof t>) => update({ trading: { ...t, ...patch } });
  return (
    <Section title="Giao dịch & Phí" desc="Phí dùng khi tính PnL journal / portfolio.">
      <Row label="Phí CK VN (%)" hint="Mỗi chiều mua/bán">
        <input
          type="number"
          step="0.01"
          min={0}
          value={t.stockFeePct}
          onChange={(e) => set({ stockFeePct: Number(e.target.value) || 0 })}
          className="input w-24"
        />
      </Row>
      <Row label="Thuế bán CK (%)" hint="Chỉ khi bán">
        <input
          type="number"
          step="0.01"
          min={0}
          value={t.sellTaxPct}
          onChange={(e) => set({ sellTaxPct: Number(e.target.value) || 0 })}
          className="input w-24"
        />
      </Row>
      <Row label="Phí crypto (%)" hint="Spot/taker">
        <input
          type="number"
          step="0.01"
          min={0}
          value={t.cryptoFeePct}
          onChange={(e) => set({ cryptoFeePct: Number(e.target.value) || 0 })}
          className="input w-24"
        />
      </Row>
      <Row label="Gồm phí trong PnL">
        <Switch on={t.includeFeesInPnl} onChange={(v) => set({ includeFeesInPnl: v })} label="Include fees" />
      </Row>
      <p className="text-[11px] text-text-muted">
        Ví dụ phí CK long: {tradeFeePct("stock", "long").toFixed(2)}% · crypto:{" "}
        {tradeFeePct("crypto", "long").toFixed(2)}%
      </p>
    </Section>
  );
}

export function DataManagementTab() {
  const { settings, update } = useSettings();
  return (
    <Section title="Quản lý dữ liệu" desc="Xuất / đặt lại cài đặt local.">
      <Row label="Xuất JSON">
        <button
          type="button"
          className="rounded-md border border-border-subtle px-2.5 py-1.5 text-[12px]"
          onClick={() => {
            const blob = new Blob([JSON.stringify(getSettingsSnapshot(), null, 2)], {
              type: "application/json",
            });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "orca-settings.json";
            a.click();
          }}
        >
          Tải xuống
        </button>
      </Row>
      <Row label="Đặt lại mặc định" hint="Xóa tùy chỉnh local">
        <button
          type="button"
          className="rounded-md border border-negative/40 px-2.5 py-1.5 text-[12px] text-negative"
          onClick={() => {
            if (confirm("Đặt lại toàn bộ cài đặt về mặc định?")) {
              localStorage.removeItem("orca.settings.v1");
              location.reload();
            }
          }}
        >
          Reset
        </button>
      </Row>
    </Section>
  );
}

export function DashboardTab() {
  const { settings, update } = useSettings();
  const d = settings.dashboard;
  return (
    <Section title="Bảng điều khiển" desc="Widget và thị trường mặc định.">
      <Row label="Thị trường mặc định">
        <Seg
          value={d.defaultMarket}
          onChange={(v) => update({ dashboard: { ...d, defaultMarket: v } })}
          options={[
            { value: "stocks", label: "CK VN" },
            { value: "crypto", label: "Crypto" },
            { value: "forex", label: "Forex" },
            { value: "commodities", label: "Hàng hóa" },
          ]}
        />
      </Row>
      <Row label="Khung thời gian">
        <Seg
          value={d.defaultTimeframe}
          onChange={(v) => update({ dashboard: { ...d, defaultTimeframe: v } })}
          options={[
            { value: "15m", label: "15m" },
            { value: "1h", label: "1h" },
            { value: "4h", label: "4h" },
            { value: "1d", label: "1D" },
          ]}
        />
      </Row>
    </Section>
  );
}

export function NotificationsTab() {
  const { settings, update } = useSettings();
  const n = settings.notifications;
  const set = (patch: Partial<typeof n>) => update({ notifications: { ...n, ...patch } });
  return (
    <Section title="Thông báo" desc="Bật/tắt loại thông báo trên thiết bị này.">
      <Row label="Tin thị trường">
        <Switch on={n.marketNews} onChange={(v) => set({ marketNews: v })} />
      </Row>
      <Row label="Cảnh báo giá">
        <Switch on={n.priceAlerts} onChange={(v) => set({ priceAlerts: v })} />
      </Row>
      <Row label="Báo cáo sẵn sàng">
        <Switch on={n.reportReady} onChange={(v) => set({ reportReady: v })} />
      </Row>
      <Row label="Tóm tắt sáng">
        <Switch on={n.digestMorning} onChange={(v) => set({ digestMorning: v })} />
      </Row>
      <Row label="Giờ yên lặng">
        <Switch on={n.quietHoursEnabled} onChange={(v) => set({ quietHoursEnabled: v })} />
      </Row>
      <Row label="Push khi tab nền" hint="Cho phép Notification khi ORCA không ở tab đang mở">
        <Switch on={n.backgroundPush} onChange={(v) => set({ backgroundPush: v })} />
      </Row>
    </Section>
  );
}

export function DataRealtimeTab() {
  const { settings, update } = useSettings();
  const r = settings.realtime;
  const set = (patch: Partial<typeof r>) => update({ realtime: { ...r, ...patch } });
  return (
    <Section title="Dữ liệu & Realtime" desc="Tần suất làm mới và chế độ tiết kiệm dữ liệu.">
      <Row label="Cập nhật trực tiếp">
        <Switch on={r.liveUpdates} onChange={(v) => set({ liveUpdates: v })} />
      </Row>
      <Row label="Chế độ tiết kiệm dữ liệu">
        <Switch on={r.lowDataMode} onChange={(v) => set({ lowDataMode: v })} />
      </Row>
      <Row label="Chu kỳ làm mới (giây)">
        <Seg
          value={String(r.refreshSeconds) as "5" | "10" | "15" | "30" | "60"}
          onChange={(v) => set({ refreshSeconds: Number(v) })}
          options={[
            { value: "5", label: "5" },
            { value: "10", label: "10" },
            { value: "15", label: "15" },
            { value: "30", label: "30" },
            { value: "60", label: "60" },
          ]}
        />
      </Row>
    </Section>
  );
}

export function AiTab() {
  const { settings, update } = useSettings();
  const a = settings.ai;
  const set = (patch: Partial<typeof a>) => update({ ai: { ...a, ...patch } });
  return (
    <Section title="Cài đặt AI" desc="Độ sâu và phong cách phân tích mặc định.">
      <Row label="Độ sâu">
        <Seg
          value={a.depth}
          onChange={(v) => set({ depth: v })}
          options={[
            { value: "concise", label: "Ngắn" },
            { value: "standard", label: "Chuẩn" },
            { value: "deep", label: "Sâu" },
          ]}
        />
      </Row>
      <Row label="Phong cách">
        <Seg
          value={a.style}
          onChange={(v) => set({ style: v })}
          options={[
            { value: "analyst", label: "Analyst" },
            { value: "technical", label: "Technical" },
            { value: "brief", label: "Brief" },
          ]}
        />
      </Row>
      <Row label="Ngôn ngữ AI">
        <Seg
          value={a.language}
          onChange={(v) => set({ language: v })}
          options={[
            { value: "vi", label: "Tiếng Việt" },
            { value: "en", label: "English" },
          ]}
        />
      </Row>
      <Row label="Công bố rủi ro">
        <Seg
          value={a.riskDisclosure}
          onChange={(v) => set({ riskDisclosure: v })}
          options={[
            { value: "standard", label: "Chuẩn" },
            { value: "detailed", label: "Chi tiết" },
            { value: "off", label: "Tắt" },
          ]}
        />
      </Row>
    </Section>
  );
}

/* -------------------------------- SECURITY -------------------------------- */

function ChangePasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const strength = next.length >= 12 ? 3 : next.length >= 8 ? 2 : next.length > 0 ? 1 : 0;
  const strengthLabel = ["", "Yếu", "Trung bình", "Tốt"][strength];
  const strengthColor = ["", "text-negative", "text-warn", "text-positive"][strength];

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setMsg(null);
    if (!current) {
      setMsg({ ok: false, text: "Nhập mật khẩu hiện tại" });
      return;
    }
    if (next.length < 8) {
      setMsg({ ok: false, text: "Mật khẩu mới tối thiểu 8 ký tự" });
      return;
    }
    if (next === current) {
      setMsg({ ok: false, text: "Mật khẩu mới phải khác mật khẩu hiện tại" });
      return;
    }
    if (next !== confirm) {
      setMsg({ ok: false, text: "Xác nhận mật khẩu không khớp" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/v1/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ current, next }),
      });
      const json = (await res.json().catch(() => null)) as {
        success?: boolean;
        error?: { message?: string; code?: string };
      } | null;
      if (res.ok && json?.success) {
        setMsg({ ok: true, text: "Đã đổi mật khẩu thành công" });
        setCurrent("");
        setNext("");
        setConfirm("");
      } else {
        setMsg({ ok: false, text: json?.error?.message ?? "Đổi mật khẩu thất bại" });
      }
    } catch {
      setMsg({ ok: false, text: "Lỗi kết nối — thử lại sau" });
    } finally {
      setBusy(false);
    }
  };

  const fieldType = show ? "text" : "password";

  return (
    <Section title="Đổi mật khẩu" desc="Mật khẩu mới tối thiểu 8 ký tự. Nên dùng chữ hoa, số và ký tự đặc biệt.">
      <form className="space-y-3" onSubmit={(e) => void submit(e)} autoComplete="on">
        <label className="block space-y-1">
          <span className="text-[12px] text-text-primary">Mật khẩu hiện tại</span>
          <input
            type={fieldType}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="input max-w-md"
            autoComplete="current-password"
            placeholder="Nhập mật khẩu đang dùng"
            required
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[12px] text-text-primary">Mật khẩu mới</span>
          <input
            type={fieldType}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className="input max-w-md"
            autoComplete="new-password"
            placeholder="Ít nhất 8 ký tự"
            minLength={8}
            required
          />
          {strength > 0 ? (
            <span className={`text-[10.5px] ${strengthColor}`}>Độ mạnh: {strengthLabel}</span>
          ) : null}
        </label>
        <label className="block space-y-1">
          <span className="text-[12px] text-text-primary">Xác nhận mật khẩu mới</span>
          <input
            type={fieldType}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="input max-w-md"
            autoComplete="new-password"
            placeholder="Nhập lại mật khẩu mới"
            minLength={8}
            required
          />
        </label>
        <label className="flex items-center gap-2 text-[11.5px] text-text-secondary">
          <input
            type="checkbox"
            checked={show}
            onChange={(e) => setShow(e.target.checked)}
            className="size-3.5 rounded border-border-subtle"
          />
          Hiện mật khẩu
        </label>
        {msg ? (
          <p className={`text-[12px] ${msg.ok ? "text-positive" : "text-negative"}`}>{msg.text}</p>
        ) : null}
        <div>
          <button
            type="submit"
            disabled={busy || !current || !next || !confirm}
            className="rounded-md bg-accent-primary px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Đang đổi…" : "Đổi mật khẩu"}
          </button>
        </div>
      </form>
    </Section>
  );
}

function SessionsSection() {
  const { data, mutate } = useApi<{ sessions: { id: string; createdAt: string; userAgent?: string; current?: boolean }[] }>(
    "/api/v1/auth/sessions",
  );
  const sessions = data?.sessions ?? [];
  return (
    <Section title="Phiên đăng nhập" desc="Thiết bị đang đăng nhập.">
      {sessions.length === 0 ? (
        <p className="text-[12px] text-text-muted">Không có phiên nào.</p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border-subtle px-2.5 py-2 text-[12px]"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-text-primary">
                  <MonitorSmartphone className="size-3.5 shrink-0" />
                  <span className="truncate">{s.userAgent || "Thiết bị"}</span>
                  {s.current ? <Badge tone="accent">Hiện tại</Badge> : null}
                </div>
                <div className="text-[10.5px] text-text-muted">{s.createdAt}</div>
              </div>
              {!s.current ? (
                <button
                  type="button"
                  className="shrink-0 text-[11px] text-negative"
                  onClick={async () => {
                    await fetch(`/api/v1/auth/sessions?id=${encodeURIComponent(s.id)}`, { method: "DELETE" });
                    void mutate();
                  }}
                >
                  Thu hồi
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function ActivitySection() {
  const { data } = useApi<{ items: { action: string; at: string }[] }>("/api/v1/auth/activity");
  const items = data?.items ?? [];
  return (
    <Section title="Hoạt động gần đây" desc="Nhật ký bảo mật tài khoản.">
      {items.length === 0 ? (
        <p className="text-[12px] text-text-muted">Chưa có hoạt động.</p>
      ) : (
        <ul className="space-y-1.5 text-[12px]">
          {items.slice(0, 12).map((it, i) => (
            <li key={i} className="flex justify-between gap-2 text-text-secondary">
              <span>{it.action}</span>
              <span className="text-[10.5px] text-text-muted">{it.at}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function SecurityTab() {
  const { data: me } = useApi<{ user: { email: string } }>("/api/v1/auth/me");
  if (!me?.user) {
    return (
      <Section title="Bảo mật" desc="Đăng nhập để quản lý tài khoản, phiên đăng nhập và hoạt động.">
        <a
          href="/login"
          className="inline-flex items-center gap-1.5 rounded-md bg-accent-primary px-3 py-1.5 text-[12px] font-semibold text-white"
        >
          <LogIn className="size-3.5" /> Đăng nhập
        </a>
      </Section>
    );
  }
  return (
    <>
      <Section title="Tài khoản" desc="Đã đăng nhập.">
        <p className="flex items-center gap-2 text-[12px] text-text-secondary">
          <ShieldCheck className="size-4 text-positive" /> {me.user.email}
        </p>
      </Section>
      <ChangePasswordSection />
      <SessionsSection />
      <ActivitySection />
    </>
  );
}
