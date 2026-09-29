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
    <>
      <Section title="Phí giao dịch" desc="Dùng để tính PnL ròng trong Nhật ký lệnh & Portfolio. Mặc định theo phí thị trường Việt Nam.">
        <Row label="Phí cổ phiếu (%/chiều)" hint={`VD: 0.15 — áp cả 2 chiều; mua = ${tradeFeePct("stock", "long")}%`}>
          <input
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={t.stockFeePct}
            onChange={(e) => set({ stockFeePct: Number(e.target.value) || 0 })}
            className="input w-24"
          />
        </Row>
        <Row label="Thuế bán cổ phiếu (%)" hint="Mặc định 0.1% giá trị bán">
          <input
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={t.sellTaxPct}
            onChange={(e) => set({ sellTaxPct: Number(e.target.value) || 0 })}
            className="input w-24"
          />
        </Row>
        <Row label="Phí crypto (%/lệnh)" hint="Phí taker Binance spot — mặc định 0.1%">
          <input
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={t.cryptoFeePct}
            onChange={(e) => set({ cryptoFeePct: Number(e.target.value) || 0 })}
            className="input w-24"
          />
        </Row>
        <Row label="Trừ phí khi tính PnL" hint="Tắt nếu bạn muốn PnL thô (gross)">
          <Switch on={t.includeFeesInPnl} onChange={(v) => set({ includeFeesInPnl: v })} label="Include fees" />
        </Row>
      </Section>
      <Section title="Ví dụ tính phí" desc="Với lệnh khớp đầy đủ entry→exit:">
        <div className="space-y-1 text-[12px] text-text-secondary">
          <p>
            Cổ phiếu: phí {t.stockFeePct}% × 2 chiều + thuế bán {t.sellTaxPct}% ≈{" "}
            <strong className="text-text-primary">{(t.stockFeePct * 2 + t.sellTaxPct).toFixed(2)}%</strong> giá trị giao dịch.
          </p>
          <p>
            Crypto (round-trip): phí {t.cryptoFeePct}% × 2 ≈ <strong className="text-text-primary">{(t.cryptoFeePct * 2).toFixed(2)}%</strong>.
          </p>
        </div>
      </Section>
    </>
  );
}

/* ------------------------------ DATA MANAGEMENT ---------------------------- */

function exportSettings() {
  const blob = new Blob([JSON.stringify(getSettingsSnapshot(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `orca-settings-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function DataManagementTab() {
  const { reset } = useSettings();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const importFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Partial<UserSettings>;
        if (typeof parsed !== "object" || parsed == null) throw new Error("bad json");
        updateSettings(parsed);
        setMsg("Đã import settings");
        setTimeout(() => setMsg(null), 2500);
      } catch {
        setMsg("File không hợp lệ");
        setTimeout(() => setMsg(null), 2500);
      }
    };
    reader.readAsText(file);
  };

  return (
    <Section title="Sao lưu & Khôi phục" desc="Xuất/nhập file JSON để chuyển thiết bị hoặc backup thủ công.">
      <div className="flex flex-wrap gap-2">
        <button onClick={exportSettings} className="rounded-md border border-border-subtle bg-surface-elevated px-3 py-1.5 text-[12px] font-medium text-text-primary hover:border-accent-primary">
          Xuất settings (.json)
        </button>
        <button onClick={() => fileRef.current?.click()} className="rounded-md border border-border-subtle bg-surface-elevated px-3 py-1.5 text-[12px] font-medium text-text-primary hover:border-accent-primary">
          Nhập settings
        </button>
        <button
          onClick={() => {
            if (confirm("Reset toàn bộ settings về mặc định?")) reset();
          }}
          className="rounded-md border border-negative/40 px-3 py-1.5 text-[12px] font-medium text-negative hover:bg-negative/10"
        >
          Reset mặc định
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) importFile(f);
          }}
        />
      </div>
      {msg ? <p className="text-[11.5px] text-positive">{msg}</p> : null}
    </Section>
  );
}

export function DashboardTab() {
  const { settings, update } = useSettings();
  const d = settings.dashboard;
  const widgets = [...d.widgets].sort((a, b) => a.order - b.order);
  const setWidgets = (w: typeof d.widgets) => update({ dashboard: { ...d, widgets: w } });
  const move = (id: string, dir: -1 | 1) => {
    const arr = widgets.map((x) => ({ ...x }));
    const i = arr.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setWidgets(arr.map((x, idx) => ({ ...x, order: idx })));
  };
  return (
    <Section title="Bo cuc Dashboard" desc="An/hien va sap xep widget.">
      <ul className="space-y-1">
        {widgets.map((w, idx) => {
          const meta = DASHBOARD_WIDGETS.find((x) => x.id === w.id);
          return (
            <li key={w.id} className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-elevated px-2.5 py-2">
              <div className="flex flex-col">
                <button type="button" onClick={() => move(w.id, -1)} disabled={idx === 0} className="text-text-muted disabled:opacity-30" aria-label="Up"><ArrowUp className="size-3" /></button>
                <button type="button" onClick={() => move(w.id, 1)} disabled={idx === widgets.length - 1} className="text-text-muted disabled:opacity-30" aria-label="Down"><ArrowDown className="size-3" /></button>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium text-text-primary">{meta?.label ?? w.id}</div>
                <div className="text-[10.5px] text-text-muted">{meta?.hint}</div>
              </div>
              <Switch on={w.visible} onChange={(v) => setWidgets(widgets.map((x) => (x.id === w.id ? { ...x, visible: v } : x)))} label={`Hien ${meta?.label}`} />
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export function NotificationsTab() {
  const { settings, update } = useSettings();
  const n = settings.notifications;
  return (
    <>
      <Section title="Thông báo" desc="Áp dụng chuông header, monitor cảnh báo giá và webhook.">
        <Row label="Tin thị trường mới" hint="Badge chuông khi có tin <30 phút">
          <Switch on={n.marketNews} onChange={(v) => update({ notifications: { ...n, marketNews: v } })} label="Tin thị trường" />
        </Row>
        <Row label="Cảnh báo giá (alerts)" hint="Bật monitor poll giá + push + webhook">
          <Switch on={n.priceAlerts} onChange={(v) => update({ notifications: { ...n, priceAlerts: v } })} label="Cảnh báo giá" />
        </Row>
        <Row label="Bản tin mới sẵn sàng" hint="Nhắc mở /reports khi đến giờ brief">
          <Switch on={n.reportReady} onChange={(v) => update({ notifications: { ...n, reportReady: v } })} label="Bản tin" />
        </Row>
        <Row label="Digest buổi sáng" hint="Gợi ý tổng kết đầu phiên 7:00-10:00 VN">
          <Switch on={n.digestMorning} onChange={(v) => update({ notifications: { ...n, digestMorning: v } })} label="Digest" />
        </Row>
      </Section>
      <Section title="Giờ yên tĩnh" desc="Tạm dừng push Notification trong khung giờ này — cảnh báo giá vẫn chạy nền.">
        <Row label="Bật giờ yên tĩnh">
          <Switch on={n.quietHoursEnabled} onChange={(v) => update({ notifications: { ...n, quietHoursEnabled: v } })} label="Quiet hours" />
        </Row>
        {n.quietHoursEnabled ? (
          <>
            <Row label="Bắt đầu">
              <input type="time" value={n.quietStart} onChange={(e) => update({ notifications: { ...n, quietStart: e.target.value } })} className="input w-28" />
            </Row>
            <Row label="Kết thúc">
              <input type="time" value={n.quietEnd} onChange={(e) => update({ notifications: { ...n, quietEnd: e.target.value } })} className="input w-28" />
            </Row>
          </>
        ) : null}
        <Row label="Push khi tab nền" hint="Cho phép Notification khi ORCA không ở tab đang mở">
          <Switch on={n.backgroundPush} onChange={(v) => update({ notifications: { ...n, backgroundPush: v } })} label="Background push" />
        </Row>
      </Section>
    </>
  );
}

export function DataRealtimeTab() {
  const { settings, update } = useSettings();
  const r = settings.realtime;
  const { data } = useApi<{ providers: ProviderStatus[] }>("/api/v1/system/providers", { refreshInterval: 10_000 });
  return (
    <>
      <Section title="Realtime" desc="Tần suất poll dữ liệu thị trường (áp dụng mọi dashboard).">
        <Row label="Live updates" hint="Bật polling theo tần suất dưới; tắt = 60s tối thiểu">
          <Switch on={r.liveUpdates} onChange={(v) => update({ realtime: { ...r, liveUpdates: v } })} label="Live" />
        </Row>
        <Row label="Low Data Mode" hint="Tiết kiệm băng thông — poll chậm tối thiểu 30s">
          <Switch on={r.lowDataMode} onChange={(v) => update({ realtime: { ...r, lowDataMode: v } })} label="Low data" />
        </Row>
      </Section>
      <Section title="Trạng thái Provider" desc="Từ Data Engine — cập nhật tự động mỗi 10s.">
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="border-b border-border-subtle text-left text-[10px] uppercase text-text-muted">
              <th className="pb-1.5">Provider</th>
              <th className="pb-1.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {(data?.providers ?? []).map((p) => (
              <tr key={p.provider} className="border-b border-border-subtle/50">
                <td className="py-1.5">{p.provider}</td>
                <td className="py-1.5"><Badge tone={p.status === "healthy" ? "up" : "neutral"}>{p.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </>
  );
}

export function AiTab() {
  const { settings, update } = useSettings();
  const a = settings.ai;
  return (
    <Section title="ORCA Agent" desc="Áp dụng cho Agent, phân tích cổ phiếu và báo cáo AI.">
      <Row label="Độ sâu phân tích">
        <Seg value={a.depth} onChange={(v) => update({ ai: { ...a, depth: v } })}
          options={[{ value: "concise", label: "Ngắn" }, { value: "standard", label: "Chuẩn" }, { value: "deep", label: "Sâu" }]} />
      </Row>
      <Row label="Phong cách" hint="Analyst = phân tích chuyên sâu; Technical = chú trọng biểu đồ; Brief = ngắn gọn">
        <Seg value={a.style} onChange={(v) => update({ ai: { ...a, style: v } })}
          options={[{ value: "analyst", label: "Analyst" }, { value: "technical", label: "Technical" }, { value: "brief", label: "Brief" }]} />
      </Row>
      <Row label="Ngôn ngữ trả lời">
        <Seg value={a.language} onChange={(v) => update({ ai: { ...a, language: v } })}
          options={[{ value: "vi", label: "Tiếng Việt" }, { value: "en", label: "English" }]} />
      </Row>
      <Row label="Cảnh báo rủi ro" hint="Mức độ hiển thị disclaimer trong output AI">
        <Seg value={a.riskDisclosure} onChange={(v) => update({ ai: { ...a, riskDisclosure: v } })}
          options={[{ value: "standard", label: "Chuẩn" }, { value: "detailed", label: "Chi tiết" }, { value: "off", label: "Tắt" }]} />
      </Row>
    </Section>
  );
}

/* --------------------------------- SECURITY -------------------------------- */

interface SessionRow {
  id: string;
  createdAt: string;
  userAgent: string | null;
  ip: string | null;
  expiresAt: string;
  current: boolean;
}
interface ActivityRow {
  id: number;
  action: string;
  createdAt: string;
}

const ACTION_LABELS: Record<string, string> = {
  password_change: "Đổi mật khẩu",
  session_revoke: "Thu hồi phiên đăng nhập",
  login: "Đăng nhập",
  logout: "Đăng xuất",
  register: "Đăng ký",
};

function ChangePasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const strength = next.length >= 12 ? 3 : next.length >= 8 ? 2 : next.length > 0 ? 1 : 0;
  const strengthLabel = ["", "Yếu", "Trung bình", "Tốt"][strength];

  const submit = async () => {
    setMsg(null);
    if (next.length < 8) {
      setMsg({ ok: false, text: "Mật khẩu mới tối thiểu 8 ký tự" });
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
        body: JSON.stringify({ current, next }),
      });
      const json = (await res.json().catch(() => null)) as { success?: boolean; error?: { message?: string } } | null;
      if (res.ok && json?.success) {
        setMsg({ ok: true, text: "Đã đổi mật khẩu" });
        setCurrent("");
        setNext("");
        setConfirm("");
      } else {
        setMsg({ ok: false, text: json?.error?.message ?? "Đổi mật khẩu thất bại" });
      }
    } catch {
      setMsg({ ok: false, text: "Lỗi kết nối" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Đổi mật khẩu" desc="Mật khẩu mới tối thiểu 8 ký tự.">
      <Row label="Mật khẩu hiện tại">
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} className="input w-44" autoComplete="current-password" />
      </Row>
      <Row label="Mật khẩu mới">
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} className="input w-44" autoComplete="new-password" />
      </Row>
      <Row label="Xác nhận mật khẩu mới" hint={strength > 0 ? `Độ mạnh: ${strengthLabel}` : undefined}>
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="input w-44" autoComplete="new-password" />
      </Row>
      {msg ? (
        <p className={`text-[11.5px] ${msg.ok ? "text-positive" : "text-negative"}`}>{msg.text}</p>
      ) : null}
      <div>
        <button onClick={submit} disabled={busy || !current || !next} className="rounded-md bg-accent-primary px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40">
          {busy ? "Đang lưu…" : "Đổi mật khẩu"}
        </button>
      </div>
    </Section>
  );
}

function SessionsSection() {
  const { data, mutate, isLoading } = useApi<{ sessions: SessionRow[] }>("/api/v1/auth/sessions");
  const [revoking, setRevoking] = useState<string | null>(null);

  const revoke = async (id: string) => {
    setRevoking(id);
    try {
      await fetch("/api/v1/auth/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await mutate();
    } finally {
      setRevoking(null);
    }
  };

  const rows = data?.sessions ?? [];
  return (
    <Section title="Phiên đăng nhập" desc="Thiết bị đang đăng nhập tài khoản của bạn.">
      {isLoading && !rows.length ? <p className="text-[11.5px] text-text-muted">Đang tải…</p> : null}
      {rows.map((s) => (
        <div key={s.id} className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-surface-elevated px-2.5 py-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-text-primary">
              <MonitorSmartphone className="size-3.5 shrink-0 text-text-muted" />
              <span className="truncate">{s.userAgent?.slice(0, 60) ?? "Thiết bị không rõ"}</span>
              {s.current ? <Badge tone="up">máy này</Badge> : null}
            </div>
            <div className="mt-0.5 text-[10.5px] text-text-muted">
              {s.ip ? `${s.ip} · ` : ""}Đăng nhập {formatAge(Date.now() - new Date(s.createdAt).getTime())}
            </div>
          </div>
          {!s.current ? (
            <button
              onClick={() => void revoke(s.id)}
              disabled={revoking === s.id}
              className="shrink-0 rounded-md border border-border-subtle px-2 py-1 text-[11px] text-text-secondary hover:text-negative disabled:opacity-40"
            >
              {revoking === s.id ? "Đang thu hồi…" : "Đăng xuất"}
            </button>
          ) : null}
        </div>
      ))}
      {!rows.length && !isLoading ? <p className="text-[11.5px] text-text-muted">Không có phiên nào.</p> : null}
    </Section>
  );
}

function ActivitySection() {
  const { data } = useApi<{ activity: ActivityRow[] }>("/api/v1/auth/activity");
  const rows = data?.activity ?? [];
  return (
    <Section title="Hoạt động gần đây" desc="20 sự kiện bảo mật mới nhất.">
      {rows.length ? (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 text-[11.5px]">
              <span className="text-text-secondary">{ACTION_LABELS[r.action] ?? r.action}</span>
              <span className="shrink-0 text-text-muted">{new Date(r.createdAt).toLocaleString("vi-VN")}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11.5px] text-text-muted">Chưa có hoạt động nào được ghi nhận.</p>
      )}
    </Section>
  );
}

export function SecurityTab() {
  const { data: me } = useApi<{ user: { email: string } }>("/api/v1/auth/me");
  if (!me?.user) {
    return (
      <Section title="Bảo mật" desc="Đăng nhập để quản lý tài khoản, phiên đăng nhập và hoạt động.">
        <a href="/login" className="inline-flex items-center gap-1.5 rounded-md bg-accent-primary px-3 py-1.5 text-[12px] font-semibold text-white">
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
